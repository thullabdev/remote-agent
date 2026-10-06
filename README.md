# Remote Agent

## 1. What it is

Watch and steer every active Claude Code Session on this machine from Telegram: receive Prompts (Questions and Permission Requests) and Reports, answer Prompts remotely, and send Instructions to idle Sessions so they continue. A local Bun Bridge talks to Telegram, and a Claude Code mod connects each Session to the Bridge.

- Glossary: [`CONTEXT.md`](CONTEXT.md)
- Decision: [ADR-0001](docs/adr/0001-mod-as-session-client.md)
- Research: [`references/`](references/README.md)

## 2. Telegram setup

1. In @BotFather: `/newbot`, then copy the token.
2. Create a private group, open its settings, enable **Topics** (this converts it to a supergroup).
3. Add the bot as an **admin** with **Manage Topics**. Admin bots receive every message, so privacy mode doesn't matter.
4. Turn off "Remain anonymous" for your own admin account. Anonymous posts arrive from the group, not from you, and the allowlist drops them.
5. Get the chat id and your user id: put `TELEGRAM_BOT_TOKEN` in `.env`, send a message in the group (Bridge stopped), then run `bun run telegram:ids`. It lists each chat (use the supergroup with Topics, id starts with `-100`) and each user (use your own id). Manual alternative: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and read `message.chat.id` and `message.from.id`.

## 3. Run the Bridge

```bash
mkdir -p ~/.config/remote-agent && cp .env.example ~/.config/remote-agent/env && chmod 600 ~/.config/remote-agent/env
# edit the values, then:
mkdir -p ~/.config/systemd/user && cp deploy/remote-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now remote-agent
journalctl --user -u remote-agent -f
```

## 4. Install the mod

```bash
claude plugin marketplace add /home/giganotosaurus/Sites/remote-agent/mod
claude plugin install remote-agent@remote-agent-local --scope user
claude plugin list
```

Already-running sessions pick it up after `/reload-plugins`.

## 5. Using it

- Each Session gets its own Thread, titled `<project> · <first 8 chars of session id>`. It is created lazily on the first message for a Session, and closed (and forgotten) when the Session ends.
- Question: one message per question. Single-select questions get one button per option. Multi-select questions are answered by replying with numbers (`1,3`). Any reply text that is not option numbers is a free-text ("Other") Answer.
- Permission Request: Allow / Deny buttons. Replying `allow`/`yes` allows, `deny`/`no` denies, and any other reply denies with that text as feedback to the agent.
- On resolution, the buttons are removed and a note is posted as a reply (for example `✅ Allowed (local)`).
- Any other text in a Session's Thread is an Instruction. It is queued if the Session is busy and delivered when the Session is idle.
- Commands: `/away` turns Away mode on (Reports are pushed), `/back` turns it off, `/status` lists Sessions and pending Prompts.

## 6. Security notes

- The socket is user-only (0600).
- Only one chat and one user are accepted. Everything else is ignored.
- Text is redacted and truncated, but Telegram bot chats are **not** end-to-end encrypted.
- The mod runs with your permissions and never approves anything without an Answer.

## 7. Known limitations

- Headless (`-p`/SDK) sessions are not bridged.
- When Telegram answers first, the terminal's question/permission dialog stays on screen. Press **Esc** to clear it; this does not interrupt Claude (see `references/spike-results.md`, E3a).
- While a Prompt waits, the terminal shows the mod's own dialog (header "Plugin"), not Claude Code's native one, so "always allow" options are not offered there.
- An Instruction sent from Telegram appears in the terminal as "Prompt from the remote-agent plugin".
- Sessions that were already running when the mod was installed need `/reload-plugins` once.
- If the Bridge is down for more than about 6 seconds while a Prompt waits, that Prompt can only be answered in the terminal.
- A Bridge that accepts connections but hangs (rather than being down) blocks the waiting hook until it is restarted.
- Secret redaction is pattern-based and best effort; Telegram bot chats are not end-to-end encrypted.

## 8. Development

Run the Bridge in the foreground instead of as a systemd service:

```bash
cp .env.example .env          # fill in the three TELEGRAM_* values; .env is git-ignored
bun run bridge                # Ctrl+C stops it and removes the socket
bun --watch run src/bridge/main.ts   # or: restart on every file change
```

Bun loads `.env` from the working directory automatically. To use the service's config file instead, run `set -a; source ~/.config/remote-agent/env; set +a` first.

Handy overrides for `.env` while developing:

```bash
REMOTE_AGENT_DB=/tmp/remote-agent-dev.db   # throwaway database
REMOTE_AGENT_REMINDER_MINUTES=1            # see reminders quickly
```

Leave `REMOTE_AGENT_SOCKET` unset: the mod always connects to the default socket path.

Check the Bridge and send a fake Permission Request without Claude Code:

```bash
SOCK="$XDG_RUNTIME_DIR/remote-agent/bridge.sock"
curl --unix-socket "$SOCK" http://bridge/health
curl --unix-socket "$SOCK" -X POST http://bridge/prompts \
  -d '{"promptId":"p:dev1","session":{"sessionId":"dev-session","cwd":"/tmp/demo"},"body":{"kind":"permission","tool":"Bash","input":{"command":"ls"}}}'
curl --unix-socket "$SOCK" "http://bridge/prompts/p%3Adev1?waitMs=25000"   # tap Allow/Deny in Telegram
```

Load the mod into a single Claude Code session without installing it:

```bash
claude --plugin-dir ~/Sites/remote-agent/mod/remote-agent
```

Tests and type checks:

```bash
bun test
bun run typecheck
```
