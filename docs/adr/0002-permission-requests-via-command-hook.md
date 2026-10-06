# Permission Requests reach the Bridge through a PermissionRequest command hook, not the mod's tool.check

Amends [ADR-0001](0001-mod-as-session-client.md): the mod remains the client for Questions, Reports and Instructions, but **Permission Requests** are carried by a `PermissionRequest` command hook that ships in the same plugin (`hooks/hooks.json` holds both `modules` and `hooks`). The hook script is `mod/remote-agent/bin/permission-hook.ts`.

## Why

The first design hooked `tool.check` and treated every `ask` verdict as "a human must decide". In the engine, `ask` means "hand this call to the current mode's decider", and in **auto mode** that decider is the classifier. The mod therefore interrupted the user with its own dialog and a Telegram prompt for calls the classifier would have settled silently. `tool.check` returns the same `ask` in default and auto mode, so the mod cannot tell the cases apart (spike R1).

A `PermissionRequest` command hook fires only when Claude Code is about to show a permission dialog, so it is correct in every mode (R3), and it runs concurrently with the native dialog (R4). That gives the first-answer-wins race with Claude Code's own dialog as the local side, which also restores its "always allow" options.

## Considered options

- **`classic.PermissionRequest` in the mod.** The natural fit, but mod `classic.*` hooks never fired in Claude Code 2.1.291 although settings hooks for the same events did (R2).
- **Skip `tool.check` in non-default modes.** The mod has no way to read the permission mode, and mode rules would duplicate Claude Code's own logic.
- **Keep `tool.check` and accept the interruption.** Rejected: it is the reported bug.

## Consequences

- A local answer does not cancel the running hook (R5). The Bridge settles the Telegram Prompt when the mod reports that the tool call finished (the mod's `tool.call` hook sees the call complete, allowed or denied) or the turn ended.
- The hook input has no `tool_use_id` (R6), so the hook generates the Prompt id and local settlement matches on session, tool name and tool input.
- The hook is a separate `bun` process per Permission Request, so `bun` must be on the `PATH` Claude Code uses for hooks. If it is missing or the Bridge is down, the hook exits silently and the native dialog is the only path.
- The mod no longer draws its own Allow/Deny dialog.
