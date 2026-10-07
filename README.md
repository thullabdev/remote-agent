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

Starting Sessions from Telegram (`/new`) needs tmux: `sudo apt install tmux`. Set `REMOTE_AGENT_PROJECTS` in the env file to get one button per project.

```bash
mkdir -p ~/.config/remote-agent && cp .env.example ~/.config/remote-agent/env && chmod 600 ~/.config/remote-agent/env
# edit the values, then:
mkdir -p ~/.config/systemd/user && cp deploy/remote-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now remote-agent
journalctl --user -u remote-agent -f
```

After changing `deploy/remote-agent.service`, copy it again and run `systemctl --user daemon-reload && systemctl --user restart remote-agent`.

## 4. Install the mod

```bash
claude plugin marketplace add /home/giganotosaurus/Sites/remote-agent/mod
claude plugin install remote-agent@remote-agent-local --scope user
claude plugin list
```

Already-running sessions pick it up after `/reload-plugins`. The plugin also installs a `PermissionRequest` hook that carries Permission Requests to Telegram.

## 5. Using it

- Each Session gets its own Thread, titled `<project> · <first 8 chars of session id>`. It is created lazily on the first message for a Session, and closed (and forgotten) when the Session ends.
- Question: one message per question. Single-select questions get one button per option. Multi-select questions are answered by replying with numbers (`1,3`). Any reply text that is not option numbers is a free-text ("Other") Answer.
- Permission Request: Allow / Deny buttons. Replying `allow`/`yes` allows, `deny`/`no` denies, and any other reply denies with that text as feedback to the agent.
- On resolution, the buttons are removed and a note is posted as a reply (for example `✅ Allowed (local)`).
- Any other text in a Session's Thread is an Instruction. It is queued if the Session is busy and delivered when the Session is idle.
- `/new` shows one button per project in `REMOTE_AGENT_PROJECTS`; `/new <path>` starts in any folder you trusted in Claude Code (exact folder, not a subfolder). The Bridge creates the Session's Thread, starts `claude` in a detached tmux session, and posts `✅ Ready` when it is up. Send your task in that Thread.
- `/new --model <model> [path]` (or `-m`) starts the Session with that model instead of your default: `opus`, `sonnet`, `haiku`, `opusplan` or a full id like `claude-sonnet-5-5`. With no path, the project buttons it posts all use that model.
- Attach in a terminal with the command shown in the Thread and in `/status` (`tmux attach -t ra-xxxxxxxx`); detach with `Ctrl-b d`. Telegram keeps working while you are attached.
- `/end` in the Thread of a Session started from Telegram sends `/exit` and kills it after 5 seconds if it is still running.
- Commands: `/new`, `/end`, `/away` turns Away mode on (Reports are pushed), `/back` turns it off, `/status` lists Sessions and pending Prompts.

## 6. Security notes

- The socket is user-only (0600).
- Only one chat and one user are accepted. Everything else is ignored.
- Text is redacted and truncated, but Telegram bot chats are **not** end-to-end encrypted.
- The mod runs with your permissions and never approves anything without an Answer.

## 7. Known limitations

- Headless (`-p`/SDK) sessions are not bridged.
- When Telegram answers a **Question** first, the terminal's question dialog stays on screen. Press **Esc** to clear it; this does not interrupt Claude (see `references/spike-results.md`, E3a). Permission dialogs close by themselves.
- Permission Requests use Claude Code's own dialog; Telegram answers race it. In auto mode only requests the classifier escalates to you reach Telegram.
- A Permission Request you answer in the terminal is settled in Telegram when the tool call **finishes**, so during a long-running command the Telegram buttons stay tappable; a tap then shows "Allowed/Denied (remote)" although nothing happens in Claude Code. When a turn ends, any Permission Request still pending for that session (including a background subagent's) is also marked "Answered in the terminal" and loses its buttons; the terminal dialog keeps working.
- A Permission Request nobody answers is dropped from the hook after about 9.5 minutes (Claude Code's own dialog keeps waiting); its Telegram buttons stay until the session ends.
- The permission hook runs with `bun`; make sure `bun` is on the `PATH` Claude Code uses for hooks (`which bun` in a fresh shell).
- An Instruction sent from Telegram appears in the terminal as "Prompt from the remote-agent plugin".
- Sessions that were already running when the mod was installed need `/reload-plugins` once.
- If the Bridge is down for more than about 6 seconds while a Question waits, that Question can only be answered in the terminal.
- A Bridge that accepts connections but hangs (rather than being down) blocks the waiting hook until it is restarted.
- Sessions started with `/new` run with your default permission mode and only in folders you trusted in Claude Code. If a Session is not up within 30 seconds (for example a login prompt), its last screen is posted and it is stopped.
- Sessions started with `/new` survive a Bridge restart, and a logout too if lingering is enabled (`loginctl enable-linger`), but never a reboot.
- `/end` works only for Sessions started from Telegram.
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
