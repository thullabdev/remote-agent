#!/usr/bin/env bash
# Regenerates docs/assets/ui-preview.png from a throwaway Bridge with demo data.
#
# It never touches your real Bridge: it uses its own port, database, socket and HOME, all under a work folder.
# Usage: ./run.sh
# Env:   PREVIEW_PORT (default 8799; the next port is used by the proxy), WORK_DIR (default /tmp/ra-preview),
#        CHROME (browser path), PREVIEW_PALETTE (default gruvbox), PREVIEW_MODE (default dark), PREVIEW_BEZEL (default #1d2021)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${WORK_DIR:-${TMPDIR:-/tmp}/ra-preview}"
PORT="${PREVIEW_PORT:-8799}"
PROXY_PORT="$((PORT + 1))"
LOGIN="demo@example.com"
# The browser talks to the proxy, which adds the identity header like tailscale serve does.
BASE="http://127.0.0.1:$PROXY_PORT"
SOCK="$WORK/bridge.sock"
OUT="$ROOT/docs/assets/ui-preview.png"

log() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }
have bun || die "bun is required (https://bun.sh)"
have python3 || die "python3 with Pillow is required"
python3 -c 'import PIL' 2>/dev/null || die "Pillow is required: pip install Pillow"

CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser chrome \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if have "$candidate" || [ -x "$candidate" ]; then
      CHROME="$(command -v "$candidate" 2>/dev/null || echo "$candidate")"
      break
    fi
  done
fi
[ -n "$CHROME" ] || die "No Chrome or Chromium found. Set CHROME to its path."

for port in "$PORT" "$PROXY_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die "Port $port is already in use. Set PREVIEW_PORT to a free port (it also uses the next one)."
  fi
done

BRIDGE_PID=""
PROXY_PID=""
cleanup() {
  for pid in "$PROXY_PID" "$BRIDGE_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

rm -rf "$WORK"
mkdir -p "$WORK/home"
echo '{"projects":{}}' >"$WORK/claude.json"

log "Installing the tool's own dependencies"
(cd "$HERE" && bun install --silent)

log "Building the web UI"
(cd "$ROOT" && bun run build)

log "Starting a throwaway Bridge on port $PORT"
# Run from the work folder so Bun does not load a .env from the repository.
(
  cd "$WORK"
  HOME="$WORK/home" \
  REMOTE_AGENT_CHANNELS=web \
  REMOTE_AGENT_WEB_PORT="$PORT" \
  REMOTE_AGENT_WEB_ALLOWED_LOGIN="$LOGIN" \
  REMOTE_AGENT_WEB_ORIGINS="$BASE" \
  REMOTE_AGENT_WEB_STATIC="$ROOT/dist/web-channel" \
  REMOTE_AGENT_DB="$WORK/bridge.db" \
  REMOTE_AGENT_SOCKET="$SOCK" \
  CLAUDE_CONFIG_PATH="$WORK/claude.json" \
  exec bun run "$ROOT/src/bridge/main.ts" >"$WORK/bridge.log" 2>&1
) &
BRIDGE_PID=$!

for _ in $(seq 1 50); do
  if curl -s --unix-socket "$SOCK" http://bridge/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.3
done
curl -s --unix-socket "$SOCK" http://bridge/health >/dev/null 2>&1 || die "The Bridge did not start. See $WORK/bridge.log"

log "Starting the proxy on $BASE"
PROXY_PORT="$PROXY_PORT" TARGET_PORT="$PORT" LOGIN="$LOGIN" bun run "$HERE/proxy.mjs" >"$WORK/proxy.log" 2>&1 &
PROXY_PID=$!
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "$BASE/"; then
    break
  fi
  sleep 0.3
done
curl -s -o /dev/null "$BASE/" || die "The proxy did not start. See $WORK/proxy.log"

log "Seeding demo data"
SOCK="$SOCK" "$HERE/seed.sh"

# The Bridge starts in Away mode; the dashboard reads better with it off.
curl -s -X PUT "http://127.0.0.1:$PORT/api/away" -H "Origin: $BASE" -H "Tailscale-User-Login: $LOGIN" \
  -H 'Content-Type: application/json' -d '{"away":false}' >/dev/null

log "Taking screenshots"
(cd "$HERE" && BASE_URL="$BASE" WORK="$WORK" CHROME="$CHROME" bun capture.mjs)

log "Composing the hero image"
(cd "$HERE" && WORK="$WORK" CHROME="$CHROME" bun compose.mjs)

log "Optimizing"
python3 "$HERE/optimize.py" "$WORK/hero-raw.png" "$OUT"
ls -l "$OUT"
