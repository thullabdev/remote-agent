# Spawned Sessions — end-to-end check

Date: <date> · Claude Code <version> · tmux <version>

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | `/new` in General, tap a project | Thread `<project> · xxxxxxxx`, `⏳ Starting…`, then `✅ Ready` within 30 s | |
| 2 | Send an Instruction in the Thread | Delivered and Claude works on it | |
| 3 | `tmux attach -t ra-xxxxxxxx`, type a prompt locally | Works; Telegram still gets Prompts/Reports | |
| 4 | `systemctl --user restart remote-agent` | Session keeps running; Instructions still delivered after restart | |
| 5 | `/new <untrusted path>` and `/new <trusted>/subfolder` | Refused with the trust message | |
| 6 | `/end` in the Thread | `⏹ Ending…`, Session exits, Thread closed, `tmux ls` no longer lists it | |
| 7 | `/end` in a terminal-started Session's Thread | `Only sessions started from Telegram can be ended remotely.` | |
| 8 | Stop tmux from reaching claude (e.g. temporarily rename `~/.local/bin/claude`), `/new` | After 30 s the screen is posted and the Thread closes | |

Run against the systemd service (not `bun run bridge` in a terminal). Note anything that differed, for example whether `/exit` via `send-keys` closes Claude Code on the first try.
