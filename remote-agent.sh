#!/usr/bin/env bash
# Runs the Remote Agent Bridge without systemd or launchd.
#
# Usage:
#   ./remote-agent.sh start [--bg]   start the Bridge in the foreground, or in the background with --bg
#   ./remote-agent.sh restart        stop the background Bridge if it runs, then start it in the background
#   ./remote-agent.sh stop           stop the background Bridge
#   ./remote-agent.sh status [--all] show whether the Bridge is running and list its active sessions and pending prompts
#                                    (--all includes ended sessions)
#   ./remote-agent.sh logs           follow the background Bridge's log
#
# Config is read from ~/.config/remote-agent/env (the same file the systemd service uses).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HOME/.config/remote-agent/env"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/remote-agent"
PID_FILE="$STATE_DIR/bridge.pid"
LOG_FILE="$STATE_DIR/bridge.log"

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'Warning: %s\n' "$*" >&2; }
die()  { printf 'Error: %s\n' "$*" >&2; exit 1; }

find_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
  elif [ -x "$HOME/.bun/bin/bun" ]; then
    echo "$HOME/.bun/bin/bun"
  else
    die "bun is not installed. See https://bun.sh"
  fi
}

# Prints the Bridge's PID and returns 0 only if that process is running and is the Bridge.
read_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  # Guard against PID reuse: the process must still be the Bridge.
  ps -p "$pid" -o args= 2>/dev/null | grep -q 'src/bridge/main.ts' || return 1
  echo "$pid"
}

check_config() {
  [ -f "$ENV_FILE" ] || die "No config at $ENV_FILE. Run ./install.sh, or copy .env.example there and edit it."
  if grep -q 'replace-me' "$ENV_FILE"; then
    die "$ENV_FILE still has placeholder values (replace-me). Edit it first."
  fi
  local output
  if ! output="$(
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    cd "$STATE_DIR"
    "$BUN" --eval "import { loadConfig } from '$REPO_DIR/src/bridge/config.ts'; loadConfig(process.env)" 2>&1
  )"; then
    die "$(printf '%s\n' "$output" | grep -m1 -o -E 'Invalid configuration: [A-Z].*' || echo "Invalid configuration in $ENV_FILE")"
  fi
}

run_foreground() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  cd "$REPO_DIR"
  exec "$BUN" run src/bridge/main.ts
}

start_background() {
  mkdir -p "$STATE_DIR"
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    cd "$REPO_DIR"
    nohup "$BUN" run src/bridge/main.ts >>"$LOG_FILE" 2>&1 </dev/null &
    echo $! >"$PID_FILE"
  )
  sleep 2
  if ! read_pid >/dev/null; then
    rm -f "$PID_FILE"
    die "The Bridge exited right after starting. Last log lines: $(tail -n 5 "$LOG_FILE" 2>/dev/null | tr '\n' ' ')"
  fi
  log "Bridge started in the background (pid $(read_pid), log: $LOG_FILE)"
}

stop_bridge() {
  local pid
  if ! pid="$(read_pid)"; then
    rm -f "$PID_FILE"
    log "Bridge is not running."
    return 0
  fi
  kill -TERM "$pid"
  for _ in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "Bridge did not stop within 10 seconds; killing pid $pid."
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  log "Bridge stopped (pid $pid)."
}

command_name="${1:-}"
shift || true

background=0
show_all=0
for arg in "$@"; do
  case "$arg" in
    --bg) background=1 ;;
    --all) show_all=1 ;;
    *) die "unknown option: $arg" ;;
  esac
done

case "$command_name" in
  start)
    if read_pid >/dev/null; then
      die "Bridge is already running (pid $(read_pid)). Use ./remote-agent.sh restart."
    fi
    BUN="$(find_bun)"
    mkdir -p "$STATE_DIR"
    check_config
    if [ "$background" -eq 1 ]; then
      start_background
    else
      log "Starting the Bridge in the foreground. Press Ctrl+C to stop."
      run_foreground
    fi
    ;;
  restart)
    BUN="$(find_bun)"
    mkdir -p "$STATE_DIR"
    check_config
    stop_bridge
    start_background
    ;;
  stop)
    stop_bridge
    ;;
  status)
    if pid="$(read_pid)"; then
      log "Bridge is running (pid $pid). Log: $LOG_FILE"
      [ -f "$ENV_FILE" ] || die "No config at $ENV_FILE, so sessions cannot be listed."
      BUN="$(find_bun)"
      flags=()
      if [ "$show_all" -eq 1 ]; then
        flags+=(--all)
      fi
      (
        set -a
        # shellcheck disable=SC1090
        . "$ENV_FILE"
        set +a
        cd "$REPO_DIR"
        "$BUN" run scripts/bridge-status.ts ${flags[@]+"${flags[@]}"}
      ) || warn "Sessions could not be listed. Is the Bridge answering on its web port?"
    else
      log "Bridge is not running."
      exit 1
    fi
    ;;
  logs)
    [ -f "$LOG_FILE" ] || die "No log yet at $LOG_FILE"
    exec tail -n 100 -f "$LOG_FILE"
    ;;
  ""|-h|--help|help)
    sed -n '2,10p' "$0"
    ;;
  *)
    die "unknown command: $command_name (try: start, restart, stop, status, logs)"
    ;;
esac
