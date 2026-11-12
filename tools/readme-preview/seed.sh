#!/usr/bin/env bash
# Seeds a throwaway Bridge with generic demo data only: made-up projects, no real names.
# Usage: SOCK=/path/to/bridge.sock HOME_DIR=/path/to/bridge/home ./seed.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOCK="${SOCK:?Set SOCK to the socket path of the throwaway Bridge}"
HOME_DIR="${HOME_DIR:?Set HOME_DIR to the HOME of the throwaway Bridge}"

# Demo transcripts first, so the Bridge finds agent activity when it first hears of each Session.
bun "$HERE/transcripts.mjs" "$HOME_DIR"

post() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --unix-socket "$SOCK" -X POST "http://bridge$1" -H 'Content-Type: application/json' -d "$2")"
  case "$code" in
    2??) ;;
    *)
      echo "seed: POST $1 answered $code" >&2
      exit 1
      ;;
  esac
}

session() {
  printf '{"sessionId":"%s","cwd":"%s"}' "$1" "$2"
}

# Usage windows reset in the future, so they stay visible whenever this runs.
FIVE_HOUR_RESET="$(bun -e 'console.log(new Date(Date.now() + 17 * 3600e3).toISOString())')"
SEVEN_DAY_RESET="$(bun -e 'console.log(new Date(Date.now() + 4 * 86400e3).toISOString())')"

# id|folder|title
SESSIONS=(
  "demo-web|/home/demo/web-app|Fix login redirect"
  "demo-api|/home/demo/api-service|Choose a cache strategy"
  "demo-docs|/home/demo/docs-site|Refresh install guide"
  "demo-mobile|/home/demo/mobile-app|Onboarding screens"
  "demo-old-1|/home/demo/web-app|Upgrade test runner"
  "demo-old-2|/home/demo/docs-site|Fix sidebar links"
)

for entry in "${SESSIONS[@]}"; do
  IFS='|' read -r id cwd title <<<"$entry"
  post /reports "{\"session\":$(session "$id" "$cwd"),\"report\":{\"kind\":\"session_started\"}}"
  post /titles "{\"session\":$(session "$id" "$cwd"),\"title\":\"$title\"}"
done

# id|folder|context percent|cost in USD
for entry in "demo-web|/home/demo/web-app|38|1.42" "demo-api|/home/demo/api-service|61|2.87" "demo-docs|/home/demo/docs-site|22|0.64" "demo-mobile|/home/demo/mobile-app|47|1.93"; do
  IFS='|' read -r id cwd percent usd <<<"$entry"
  post /usage "{\"session\":$(session "$id" "$cwd"),\"source\":\"claude-code\",\"usage\":{\"context\":{\"tokens\":$((percent * 2000)),\"window\":200000,\"percent\":$percent},\"rateLimits\":[{\"kind\":\"five_hour\",\"percentUsed\":54,\"resetsAt\":\"$FIVE_HOUR_RESET\"},{\"kind\":\"seven_day\",\"percentUsed\":31,\"resetsAt\":\"$SEVEN_DAY_RESET\"}],\"cost\":{\"usd\":$usd}}}"
done

# Give the Bridge a moment to read the transcripts, so the prompt cards land after the agent activity.
sleep 4

# A permission request and a question, so two Sessions need the user.
post /prompts "{\"promptId\":\"p:demo-web-1\",\"session\":$(session demo-web /home/demo/web-app),\"body\":{\"kind\":\"permission\",\"tool\":\"Bash\",\"input\":{\"command\":\"bun test\"},\"reason\":\"Run the test suite\"}}"
post /prompts "{\"promptId\":\"p:demo-api-1\",\"session\":$(session demo-api /home/demo/api-service),\"body\":{\"kind\":\"question\",\"questions\":[{\"question\":\"Which cache should the reads use?\",\"header\":\"Cache\",\"multiSelect\":false,\"options\":[{\"label\":\"In-memory LRU\",\"description\":\"Fast and simple, lost on restart\"},{\"label\":\"Redis\",\"description\":\"Shared across instances\"},{\"label\":\"No cache\",\"description\":\"Keep reads direct until load requires it\"}]}]}}"

# Finished turns and ended Sessions.
post /reports "{\"session\":$(session demo-docs /home/demo/docs-site),\"report\":{\"kind\":\"turn_complete\",\"text\":\"Updated the install guide and fixed two broken links.\",\"durationMs\":94000,\"isAborted\":false}}"
post /reports "{\"session\":$(session demo-old-1 /home/demo/web-app),\"report\":{\"kind\":\"session_ended\",\"reason\":\"other\"}}"
post /reports "{\"session\":$(session demo-old-2 /home/demo/docs-site),\"report\":{\"kind\":\"session_ended\",\"reason\":\"other\"}}"

echo "seed: done"
