#!/usr/bin/env bash
# Installs Remote Agent on Linux (systemd user service) or macOS (launchd agent).
# On Windows, run install.ps1, which runs this script inside WSL2.
#
# Usage: ./install.sh [--no-service] [--no-plugin]
#   --no-service  do not install the background Bridge service
#   --no-plugin   do not install the Claude Code mod
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$HOME/.config/remote-agent"
ENV_FILE="$CONFIG_DIR/env"
WRAPPER="$CONFIG_DIR/run-bridge.sh"
SYSTEMD_UNIT="$HOME/.config/systemd/user/remote-agent.service"
PLIST_LABEL="com.remote-agent.bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
LOG_FILE="$HOME/Library/Logs/remote-agent.log"

INSTALL_SERVICE=1
INSTALL_PLUGIN=1
for arg in "$@"; do
  case "$arg" in
    --no-service) INSTALL_SERVICE=0 ;;
    --no-plugin) INSTALL_PLUGIN=0 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

NEXT_STEPS=()

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=macos ;;
  *) die "Unsupported OS: $(uname -s). On Windows, run install.ps1 (it uses WSL2)." ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  die "Run this as your normal user, not root. The service and the mod are per user."
fi

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif have sudo; then
    sudo "$@"
  else
    die "Installing packages needs root, and sudo is not available. Install tmux yourself, then rerun ./install.sh."
  fi
}

install_tmux() {
  if [ "$OS" = macos ]; then
    have brew || die "tmux is missing and Homebrew is not installed. Install Homebrew (https://brew.sh) or tmux, then rerun."
    brew install tmux
  elif have apt-get; then
    as_root apt-get update
    as_root apt-get install -y tmux
  elif have dnf; then
    as_root dnf install -y tmux
  elif have pacman; then
    as_root pacman -S --noconfirm tmux
  elif have zypper; then
    as_root zypper install -y tmux
  else
    die "tmux is missing and no supported package manager was found. Install tmux, then rerun."
  fi
}

ensure_bun() {
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  if ! have bun; then
    log "Installing Bun (https://bun.sh)"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  have bun || die "Bun is not on PATH after installing it. Open a new shell or see https://bun.sh."
}

# True when the env file loads and passes the Bridge's own validation.
# Runs from CONFIG_DIR so Bun does not auto-load the repo's .env and hide a missing value.
config_ready() {
  local output
  if grep -q 'replace-me' "$ENV_FILE"; then
    warn "$ENV_FILE still has placeholder values (replace-me). Edit it first."
    return 1
  fi
  if output="$(
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    cd "$CONFIG_DIR"
    bun --eval "import { loadConfig } from '$REPO_DIR/src/bridge/config.ts'; loadConfig(process.env)" 2>&1
  )"; then
    return 0
  fi
  warn "Configuration is not ready yet: $(printf '%s\n' "$output" | grep -m1 -o -E 'Invalid configuration: [A-Z].*' || echo "see $ENV_FILE")"
  return 1
}

install_systemd_unit() {
  if ! have systemctl || ! systemctl --user show-environment >/dev/null 2>&1; then
    warn "systemd user services are not available, so the Bridge runs with ./remote-agent.sh instead."
    return 1
  fi
  if ! have systemd-run; then
    warn "systemd-run is missing. The Bridge runs, but /new cannot start Sessions."
  fi
  mkdir -p "$(dirname "$SYSTEMD_UNIT")"
  sed \
    -e "s|^WorkingDirectory=.*|WorkingDirectory=$REPO_DIR|" \
    -e "s|^ExecStart=.*|ExecStart=$(command -v bun) run src/bridge/main.ts|" \
    "$REPO_DIR/deploy/remote-agent.service" > "$SYSTEMD_UNIT"
  systemctl --user daemon-reload
  log "Installed $SYSTEMD_UNIT"
}

install_launchd_agent() {
  mkdir -p "$CONFIG_DIR" "$(dirname "$PLIST_PATH")" "$(dirname "$LOG_FILE")"
  cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
set -a
. "$ENV_FILE"
set +a
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$REPO_DIR"
exec "$(command -v bun)" run src/bridge/main.ts
EOF
  chmod 700 "$WRAPPER"
  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WRAPPER</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
</dict>
</plist>
EOF
  log "Installed $PLIST_PATH"
}

# Sets REMOTE_AGENT_WEB_STATIC to the built UI unless the env file already names a folder.
ensure_web_static() {
  local key="REMOTE_AGENT_WEB_STATIC"
  if grep -Eq "^${key}=.+" "$ENV_FILE"; then
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$ENV_FILE" >"$tmp" || true
  printf '%s="%s"\n' "$key" "$REPO_DIR/dist/web-channel" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Set $key in $ENV_FILE"
}

# 1. Prerequisites
log "Checking prerequisites on $OS"
ensure_bun
if ! have tmux; then
  log "Installing tmux (needed to start Sessions from the chat)"
  install_tmux
fi
if ! have claude; then
  warn "Claude Code (claude) is not on PATH. Install it from https://claude.com/claude-code, then rerun ./install.sh to add the mod."
fi

# 2. Dependencies and the web UI
log "Installing dependencies"
(cd "$REPO_DIR" && bun install --frozen-lockfile)
log "Building the web UI"
(cd "$REPO_DIR" && bun run build)

# 3. Configuration (never overwrites an existing env file)
mkdir -p "$CONFIG_DIR"
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_DIR/.env.example" "$ENV_FILE"
  log "Created $ENV_FILE from .env.example"
  NEXT_STEPS+=("Edit $ENV_FILE and set the required values (see Configuration in README.md).")
else
  log "Keeping existing $ENV_FILE"
fi
chmod 600 "$ENV_FILE"
ensure_web_static

# 4. Bridge service
if [ "$INSTALL_SERVICE" -eq 1 ]; then
  if [ "$OS" = linux ]; then
    if install_systemd_unit; then
      if config_ready; then
        systemctl --user enable remote-agent
        systemctl --user restart remote-agent
        log "Bridge service enabled and (re)started"
      else
        NEXT_STEPS+=("Then start the Bridge: systemctl --user enable --now remote-agent")
      fi
    else
      if config_ready; then
        "$REPO_DIR/remote-agent.sh" restart
      else
        NEXT_STEPS+=("Then start the Bridge: $REPO_DIR/remote-agent.sh restart")
      fi
    fi
  else
    install_launchd_agent
    if config_ready; then
      launchctl bootout "gui/$(id -u)/$PLIST_LABEL" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
      log "Bridge agent loaded (log: $LOG_FILE)"
    else
      NEXT_STEPS+=("Then start the Bridge: launchctl bootstrap gui/$(id -u) $PLIST_PATH")
    fi
  fi
fi

# 5. Claude Code mod
if [ "$INSTALL_PLUGIN" -eq 1 ]; then
  if have claude; then
    log "Installing the Claude Code mod"
    claude plugin marketplace add "$REPO_DIR/mod" || warn "marketplace add failed (it may already be added)"
    claude plugin install remote-agent@remote-agent-local --scope user || warn "plugin install failed; see Manual installation in README.md"
    NEXT_STEPS+=("Run /reload-plugins in Claude Code sessions that were already running.")
  else
    NEXT_STEPS+=("Install Claude Code, then rerun ./install.sh to add the mod.")
  fi
fi

echo
log "Done."
if [ "$OS" = macos ]; then
  warn "On macOS, /new cannot start Sessions yet: the Launcher calls systemd-run, which exists only on Linux."
fi
if [ "${#NEXT_STEPS[@]}" -gt 0 ]; then
  echo "Next steps:"
  for step in "${NEXT_STEPS[@]}"; do
    echo "  - $step"
  done
fi
