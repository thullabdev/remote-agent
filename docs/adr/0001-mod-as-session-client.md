# Sessions reach the Bridge through a Claude Code mod, not settings hooks or Channels

Every Session talks to the Bridge through a small Claude Code mod (in-process JS/TS hooks) installed at user scope, which calls the Bridge over a local Unix socket. We chose it because it is the only mechanism that works for already-running plain `claude` sessions (after one `/reload-plugins`) **and** can deliver an Instruction as a genuine user turn (`$.prompt.submit({ asUser: true })`) **and** can keep the terminal answerable while waiting for a remote Answer (first Answer wins).

## Considered options

- **Settings hooks (command/HTTP)** — stable and documented, hot-reloaded. Rejected: while a PreToolUse hook waits on AskUserQuestion the local dialog is hidden (no local/remote race), and Instructions could only arrive via a Stop-hook `block` or the inbox socket, which frames them as "from another session".
- **Channels (`--channels`)** — official Telegram support with a documented permission race. Rejected: requires launching every session with special flags (plus a dev flag for custom channels), contradicting "all sessions on this machine".
- **Wrapper (Agent SDK / tmux)** — full control, but only for sessions the wrapper launched.

## Consequences

- Mods are new (v2.1.287+) and some behaviour (cancelling a pending `$.ui.ask` when the remote side wins) is undocumented; the first implementation task is a spike that verifies these against the installed CLI.
- A mod runs with the user's full permissions; it must never auto-approve anything without an Answer.
- If the Bridge is unreachable, the mod falls back to Claude Code's native local behaviour.
