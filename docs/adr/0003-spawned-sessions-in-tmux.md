# Spawned Sessions run interactive claude in tmux, launched in their own systemd scope

Extends [ADR-0001](0001-mod-as-session-client.md). When the user starts a Session from the Channel, the Bridge runs plain interactive `claude --session-id <uuid>` inside a detached tmux session, started through `systemd-run --user --scope` so it lives outside the Bridge service's cgroup. The launch is prefixed with `env -u` for the Telegram variables so the Bridge's credentials never reach the spawned `claude`. We chose it because the user must be able to attach to the **same live Session** in a terminal later, and because an interactive `claude` loads the mod like any other Session, so Prompts, Reports and Instructions need no new code path.

## Considered options

- **Headless (Agent SDK / `claude -p`), then `--resume` locally.** Rejected: headless Sessions are not bridged by the mod, so Prompts would need a second implementation, and resuming starts a new process rather than attaching.
- **Bridge-owned pseudo-terminal (`script -qfc`) plus a `/handoff` that stops it so the user can `claude --resume`.** Rejected: the Session is in one place at a time, the Bridge has to babysit a fake terminal, and a Bridge restart kills the Session.
- **tmux without `systemd-run --scope`.** Rejected: the tmux server would be in the service's cgroup and `systemctl --user restart remote-agent` would kill every Spawned Session.

## Consequences

- tmux is a new runtime dependency (only for `/new`; everything else works without it).
- The service's `PATH` must include `claude`, `bun` and `tmux`.
- Only directories listed in `REMOTE_AGENT_PROJECTS` or as project keys in Claude Code's config are allowed. The check does not require Claude Code's trust acceptance, so a spawned `claude` can stop at the trust dialog for a folder that was never accepted; the Session's last screen is posted and it is stopped after the startup timeout.
