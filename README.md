# Remote Agent

## 1. What it is

Watch and steer every active Claude Code Session on this machine from a web chat (or Telegram): receive Prompts (Questions and Permission Requests) and Reports, answer Prompts remotely, and send Instructions to idle Sessions so they continue. A local Bun Bridge serves the web chat (or talks to Telegram), and a Claude Code mod connects each Session to the Bridge.

- Glossary: [`CONTEXT.md`](CONTEXT.md)
- Decisions: [ADR-0001](docs/adr/0001-mod-as-session-client.md), [ADR-0004 (web channel)](docs/adr/0004-web-channel.md)
- Research: [`references/`](references/README.md)

## 2. Web channel

The web channel is the default (`REMOTE_AGENT_CHANNELS=web`). It serves a JSON API, a WebSocket and, when `REMOTE_AGENT_WEB_STATIC` is set, a built UI, all on `127.0.0.1:$REMOTE_AGENT_WEB_PORT` (default 8787). Nothing listens on a public interface, so devices reach it through Tailscale.

1. Set the two required values in `~/.config/remote-agent/env`:
   ```bash
   REMOTE_AGENT_WEB_ALLOWED_LOGIN=you@example.com        # your Tailscale login
   REMOTE_AGENT_WEB_ORIGINS=https://box.tail1234.ts.net  # your MagicDNS https URL, exactly (scheme and host)
   ```
2. Publish the port over HTTPS on your tailnet: `tailscale serve --bg 8787`. `tailscale serve status` shows the URL to use for `REMOTE_AGENT_WEB_ORIGINS`.
3. Open that URL on a device in your tailnet. Tailscale adds the `Tailscale-User-Login` header, which the Bridge checks against `REMOTE_AGENT_WEB_ALLOWED_LOGIN`.

`REMOTE_AGENT_WEB_ORIGINS` must hold the MagicDNS URL with `https://`. A bare host such as `box.tail1234.ts.net` never matches a browser's `Origin`, and every write from the browser is refused. Same-origin GET and HEAD requests may omit `Origin` when the browser sends `Sec-Fetch-Site: same-origin`.

- **UI build and install:** point `REMOTE_AGENT_WEB_STATIC` at the built UI directory. Its files are served with an `index.html` fallback. Without it the Bridge serves only the API and the WebSocket. The built UI is installable as a PWA (in a browser's install menu, or on iOS via Share → Add to Home Screen). After the first online load, the app shell and static assets are available offline; chat history, live updates and actions still require the Bridge.
- **Push on iPhone and iPad:** Web Push works only for a page added to the Home Screen (Share, then Add to Home Screen) and opened from there. It also needs HTTPS, which `tailscale serve` provides.
- **Push subject:** set `REMOTE_AGENT_VAPID_SUBJECT` to a `mailto:` address of yours. Push services such as Apple's may reject the default. The VAPID key pair is created once in `vapid.json` next to the database.
- **Building a client or changing the backend:** see the [web channel developer guide](docs/web-channel-developer-guide.md) for the API reference, the WebSocket protocol, push, and how to extend the server.
- **Away mode and push:** Prompts are always pushed. Reports (turn finished, session ended) are pushed only while Away mode is on, which it is when the Bridge starts (`/away`, `/back`). Nothing is pushed while a client is visible and focused.

## 3. Telegram setup (optional)

Telegram is off by default. Add `telegram` to `REMOTE_AGENT_CHANNELS` to use it; its three `TELEGRAM_*` variables are then required. Listing both `web` and `telegram` is not a composite: the Bridge logs `both channels selected; starting the web channel only` and runs the web channel alone.


1. In @BotFather: `/newbot`, then copy the token.
2. Create a private group, open its settings, enable **Topics** (this converts it to a supergroup).
3. Add the bot as an **admin** with **Manage Topics**. Admin bots receive every message, so privacy mode doesn't matter.
4. Turn off "Remain anonymous" for your own admin account. Anonymous posts arrive from the group, not from you, and the allowlist drops them.
5. Get the chat id and your user id: put `TELEGRAM_BOT_TOKEN` in `.env`, send a message in the group (Bridge stopped), then run `bun run telegram:ids`. It lists each chat (use the supergroup with Topics, id starts with `-100`) and each user (use your own id). Manual alternative: `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and read `message.chat.id` and `message.from.id`.

### Upgrading from the Telegram-only Bridge

The default channel is now `web`. An existing Telegram deployment that keeps its env file unchanged will not start: the Bridge refuses with `Invalid configuration` and names the missing `REMOTE_AGENT_WEB_*` variable. Either add `REMOTE_AGENT_CHANNELS=telegram` to `~/.config/remote-agent/env` to keep Telegram only, or add the web variables (section 2) to run the web channel.

## 4. Run the Bridge

Starting Sessions from the chat or Telegram (`/new`) needs tmux: `sudo apt install tmux`. The project picker uses folders Claude Code has marked as trusted in `~/.claude.json`.

```bash
mkdir -p ~/.config/remote-agent && cp .env.example ~/.config/remote-agent/env && chmod 600 ~/.config/remote-agent/env
# edit the values, then:
mkdir -p ~/.config/systemd/user && cp deploy/remote-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now remote-agent
journalctl --user -u remote-agent -f
```

After changing `deploy/remote-agent.service`, copy it again and run `systemctl --user daemon-reload && systemctl --user restart remote-agent`.

## 5. Desktop development app

The Electron shell reuses the web UI and starts its own local Bridge. On Linux, run:

```bash
bun install
bun run desktop:dev
```

The desktop Bridge stores its database under Electron's user-data directory, uses a per-launch bearer token, and listens on a free loopback port. The token is sent on the WebSocket handshake only because browser WebSockets cannot set authorization headers; the Bridge still requires the exact local Origin. Its data is separate from a separately running web Bridge. Starting Sessions still requires Claude Code, `tmux`, and `systemd-run --user`. Set `BUN_EXECUTABLE` if Bun is not on `PATH`. Web Push and the service worker are disabled in the desktop app; the browser/PWA keeps its existing behavior.

To connect the desktop app to an already-running web Bridge instead, set these in `.env` before launching:

```bash
REMOTE_AGENT_DESKTOP_BRIDGE_MODE=existing
REMOTE_AGENT_DESKTOP_BRIDGE_URL=https://box.tail1234.ts.net
```

The service must serve the built UI and `REMOTE_AGENT_WEB_ORIGINS` must include the exact URL origin. When the service authenticates through Tailscale Serve, the desktop app uses that service-provided identity. For a service configured with `REMOTE_AGENT_WEB_TOKEN`, also set `REMOTE_AGENT_DESKTOP_BRIDGE_TOKEN` to the same token. In this mode the desktop app does not start or stop a Bridge and shows that service's Chats. Remove the mode or set it to `managed` to return to the isolated local Bridge (the default).

## 6. Install the mod

```bash
claude plugin marketplace add /home/giganotosaurus/Sites/remote-agent/mod
claude plugin install remote-agent@remote-agent-local --scope user
claude plugin list
```

Already-running sessions pick it up after `/reload-plugins`. The plugin also installs a `PermissionRequest` hook that carries Permission Requests to Telegram.

## 7. Using it

The rules below are the same in the web chat, where a Session's Thread is its Chat. The wording is Telegram's.

- Each Session gets its own Thread, titled `<project> · <first 8 chars of session id>`. It is created lazily on the first message for a Session, and closed (and forgotten) when the Session ends.
- Question: one message per question. Single-select questions get one button per option. Multi-select questions are answered by replying with numbers (`1,3`). Any reply text that is not option numbers is a free-text ("Other") Answer.
- Permission Request: Allow / Deny buttons. Replying `allow`/`yes` allows, `deny`/`no` denies, and any other reply denies with that text as feedback to the agent.
- On resolution, the buttons are removed and a note is posted as a reply (for example `✅ Allowed (local)`).
- Any other text in a Session's Thread is an Instruction. It is queued if the Session is busy and delivered when the Session is idle.
- `/new` shows one button per folder marked trusted in Claude Code's `~/.claude.json`; `/new <path>` starts only in an exactly matching trusted folder, not a subfolder. The Bridge creates the Session's Thread, starts `claude` in a detached tmux session, and posts `✅ Ready` when it is up. Send your task in that Thread.
- `/new --resume [path]` lists the recent Claude histories in a trusted folder (or asks you to pick a project); selecting one starts a new Session forked from that transcript, leaving the original history unchanged.
- `/new --model <model> [path]` (or `-m`) starts the Session with that model instead of your default: `opus`, `sonnet`, `haiku`, `opusplan` or a full id like `claude-sonnet-5-5`. With no path, the project buttons it posts all use that model.
- Attach in a terminal with the command shown in the Thread and in `/status` (`tmux attach -t ra-xxxxxxxx`); detach with `Ctrl-b d`. Telegram keeps working while you are attached.
- `/end` in the Thread of a Session started from Telegram sends `/exit` and kills it after 5 seconds if it is still running.
- Commands: `/new`, `/end`, `/away` turns Away mode on (Reports are pushed), `/back` turns it off, `/status` lists Sessions and pending Prompts.

## 8. Security notes

- The socket is user-only (0600).
- Web: the port is loopback only. Access needs the allowed Tailscale login and an allowed Origin (see section 2); the optional `REMOTE_AGENT_WEB_TOKEN` is a bearer fallback for access not through `tailscale serve`.
- Telegram: only one chat and one user are accepted. Everything else is ignored.
- Text is redacted and truncated, but Telegram bot chats are **not** end-to-end encrypted.
- The mod runs with your permissions and never approves anything without an Answer.

## 9. Known limitations

- Headless (`-p`/SDK) sessions are not bridged.
- When Telegram answers a **Question** first, the terminal's question dialog stays on screen. Press **Esc** to clear it; this does not interrupt Claude (see `references/spike-results.md`, E3a). Permission dialogs close by themselves.
- Permission Requests use Claude Code's own dialog; Telegram answers race it. In auto mode only requests the classifier escalates to you reach Telegram.
- A Permission Request you answer in the terminal is settled in Telegram when the tool call **finishes**, so during a long-running command the Telegram buttons stay tappable; a tap then shows "Allowed/Denied (remote)" although nothing happens in Claude Code. When a turn ends, any Permission Request still pending for that session (including a background subagent's) is also marked "Answered in the terminal" and loses its buttons; the terminal dialog keeps working.
- A Permission Request nobody answers is dropped from the hook after about 9.5 minutes (Claude Code's own dialog keeps waiting); its Telegram buttons stay until the session ends.
- The permission hook runs with `bun`; make sure `bun` is on the `PATH` Claude Code uses for hooks (`which bun` in a fresh shell).
- An Instruction sent from Telegram appears in the terminal as "Prompt from the remote-agent plugin".
- Sessions that were already running when the mod was installed need `/reload-plugins` once.
- A Session already running when the Bridge starts gets its web chat at its next report, prompt or title, not at once: the mod's instruction poll carries only a session id, so the Bridge cannot create the chat from it.
- If the Bridge is down for more than about 6 seconds while a Question waits, that Question can only be answered in the terminal.
- A Bridge that accepts connections but hangs (rather than being down) blocks the waiting hook until it is restarted.
- Sessions started with `/new` run with your default permission mode and only in folders you trusted in Claude Code. If a Session is not up within 30 seconds (for example a login prompt), its last screen is posted and it is stopped.
- Sessions started with `/new` survive a Bridge restart, and a logout too if lingering is enabled (`loginctl enable-linger`), but never a reboot.
- `/end` works only for Sessions the Bridge started (`/new` or a project start, from Telegram or the web chat).
- Secret redaction is pattern-based and best effort; Telegram bot chats are not end-to-end encrypted.

## 10. Development

Run the Bridge in the foreground instead of as a systemd service:

```bash
cp .env.example .env          # fill in the values for your channel; .env is git-ignored
bun run bridge                # Ctrl+C stops it and removes the socket
bun --watch run src/bridge/main.ts   # or: restart on every file change
```

Bun loads `.env` from the working directory automatically. To use the service's config file instead, run `set -a; source ~/.config/remote-agent/env; set +a` first.

Settings (the variables read by `src/bridge/config.ts`):

| Variable | Default | Meaning |
| :- | :- | :- |
| `REMOTE_AGENT_CHANNELS` | `web` | Comma list of `web` and `telegram`. Both selected means web only (logged). |
| `REMOTE_AGENT_WEB_PORT` | `8787` | Loopback port of the web channel. |
| `REMOTE_AGENT_WEB_ALLOWED_LOGIN` | required with web | The Tailscale login allowed in. |
| `REMOTE_AGENT_WEB_ORIGINS` | required with web | Comma list of allowed origins, for example `https://box.tail1234.ts.net`. |
| `REMOTE_AGENT_WEB_TOKEN` | none | Optional bearer token for access not through `tailscale serve`. |
| `REMOTE_AGENT_WEB_STATIC` | none | Built UI directory to serve, with `index.html` fallback. |
| `REMOTE_AGENT_VAPID_SUBJECT` | `mailto:remote-agent@localhost` | Contact in the Web Push keys: a `mailto:` or `https:` URL. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ALLOWED_USER_ID` | required with telegram | See section 3. |
| `REMOTE_AGENT_DB` | `~/.local/state/remote-agent/bridge.db` | SQLite database (chat log, sessions, prompts). |
| `REMOTE_AGENT_REMINDER_MINUTES` | `30` | Reminder for a Prompt nobody answers. |
| `CLAUDE_CONFIG_PATH` | `~/.claude.json` | Claude Code config used to find trusted folders. |

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
