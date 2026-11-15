# Extension system + terminal plugin (pilot) — design

Date: 2026-11-15
Status: draft, awaiting approval
Glossary: [`CONTEXT.md`](../../../CONTEXT.md)
Builds on: [Web terminal spec](/tmp/opencode/uploads/efebc2e7-131a-4988-9c29-de4e88c8d0b3/Web terminal spec.md) (attached, not committed)
Storage: [Extension platform storage](2026-11-15-extension-storage-design.md) (key/value, declared collections, migrations, purge). Implemented on `feat/extension-storage`.

## Intent

Turn Remote Agent into an extensible platform whose first real capability is a VS Code-style web terminal. An **extension** is a folder of code + a manifest that the host loads at startup. Extensions can contribute frontend panels (rendered in the app's main area, approach B — terminal is its own section, not inside a chat), backend HTTP/WebSocket routes, and commands. The terminal is the pilot plugin that proves the system works.

Why an extension system instead of wiring the terminal directly: the terminal needs a raw PTY byte stream, a full-viewport terminal emulator (xterm.js), its own tab lifecycle, and backend process control (node-pty). None of these fit the chat/MessageFeed model, and none should be hardcoded into the host. A plugin system makes the terminal one capability among many, each installable as a folder, with a stable, typed SDK so adding the next extension is "drop a folder, restart."

## Goals

- **Extension system.** Extensions are folders under `extensions/` containing `plugin.json` plus code. The host discovers, loads, activates, and deactivates them at startup.
- **Extension SDK (`@remote-agent/extension-sdk`).** Typed, minimal API: register a frontend panel, register backend HTTP/WebSocket routes, register commands, and `onActivate`/`onDeactivate` lifecycle. An extension author should not need to touch host internals.
- **Terminal as first plugin.** A real PTY-backed shell (xterm.js + node-pty + WebSocket) reachable only through Tailscale Serve with an allowlisted email, exactly per the attached spec.
- **Terminal is its own section (approach B).** Multiple terminal tabs, each a persistent PTY session identified by `sid`, surviving page reloads and brief disconnects via `replay` on reattach. Reachable from the dashboard, a sidebar entry, a keyboard shortcut, and an "Open terminal" action from any chat (passing that session's working directory).
- **Easy to integrate.** Drop an extension folder, restart the Bridge; no manifest edits in host code, no rebuild of the host for a new extension.
- **DX friendly.** One command to scaffold a new extension; typed SDK; terminal plugin is the worked example.

## Non-goals (v1)

- Runtime install/uninstall of extensions without a restart. Extensions are discovered at startup from `extensions/`.
- Multi-tenant hosting for untrusted users, public internet access (Tailscale Funnel), file upload/download through the terminal, session recording/audit replay (all per the terminal spec non-goals).
- A marketplace or remote extension registry. Extensions are local folders only.
- Sandboxing extensions from each other or the host (see Constraints).

## Anti-goals

- A terminal tab embedded inside a chat transcript (approach A). The terminal is stateful and full-viewport; it does not belong in a scrollable message feed.
- An extension crashing or misbehaving taking down the Bridge without at least an error boundary and a clear deactivation path.
- Whitelisting host internals ad hoc. The SDK surface is the contract; if the terminal needs something the SDK doesn't expose, the SDK grows, not the host's internals leak.

## Constraints

- Stack: Bun + TypeScript on the backend; Vite + React + Tailwind on the frontend. `Bun.serve` (HTTP + built-in WebSocket) stays the single listener on `127.0.0.1` behind Tailscale Serve.
- One process: extensions load into the same Bun backend process and the same React frontend process (Approach 1 below). No serialization boundary between host and extension in v1.
- Security (from the terminal spec, requirements not suggestions): bind to `127.0.0.1` only; serve only through Tailscale Serve (HTTPS/wss); check Tailscale identity (`Tailscale-User-Login`) and `Origin` on every WebSocket upgrade before creating any PTY; run shell as an unprivileged user; strip secrets from the shell environment; log open/close/failed auth (login + timestamp, no keystrokes or output).
- `CONTEXT.md` language applies: "Session" means a Claude Code session. A terminal session is **not** a Chat — it is its own thing identified by `sid`. Do not force the terminal into the Chat domain model.
- Coding rule: no short-if early returns in TypeScript (use braces).
- Existing `WebServerDeps`/`startWebServer` in `src/channel/web/server.ts` stays the entry point; extensions hook into it, they do not replace it.

## Approaches considered

**1 — In-process extension host (VS Code model).** Extensions are TS/JS loaded into the Bun backend and the React frontend. They call the SDK to register panels, routes, and commands. Direct, typed access to host internals; no message-passing tax. *Picked.*

**2 — Out-of-process / iframe sandbox (browser-extension model).** Frontend extensions in isolated iframes; backend extensions in separate Bun processes; host and extension talk over message ports. *Rejected:* poor DX, serialization of every PTY byte, complex build setup — fights "easy to integrate."

**3 — Declarative manifest-only.** Extensions are JSON + static assets interpreted by the host; no custom extension code. *Rejected:* a raw PTY byte stream plus xterm.js cannot be expressed in static config.

## Decisions

These are my calls. Each can be changed before the plan is written.

1. **Host process, one extension registry.** The Bridge process owns a backend `ExtensionRegistry`. At startup it scans `extensions/`, validates each `plugin.json`, loads the extension's backend entry, calls `onActivate(extensionApi)`, and on shutdown calls `onDeactivate()`. The React app owns a frontend `ExtensionRegistry` that renders contributed panels as tabs in the main area, alongside Dashboard and MessageFeed.

2. **Manifest (`plugin.json`).** Fields: `id` (reverse-domain style, e.g. `remote-agent.terminal`), `name`, `version`, `frontend.entry` (relative path to the panel component module), `backend.entry` (relative path to the backend module), `permissions` (list of capabilities the extension requests, e.g. `pty`, `websocket-routes`). The host validates and refuses unknown permissions.

3. **Frontend panel contract.** An extension panel is a React component receiving `{ id, title, onClose, api }` where `api` is the frontend slice of the extension SDK (postMessage to the extension's backend route, etc.). Panels are rendered by `ExtensionRegistry` in `app.tsx`'s main area when a terminal tab is active (`?terminal=<sid>`), with the `ChatList` sidebar still present. Multiple tabs = multiple terminal sessions, each with its own xterm instance and `sid`.

4. **Backend route contract.** An extension registers HTTP and WebSocket routes through `backendApi.registerHttpRoute(method, path, handler)` and `backendApi.registerWebSocketRoute(path, handlers)`. The terminal plugin registers a WebSocket route (e.g. `/api/terminal/ws`) implementing the spec's `open`/`input`/`resize`/`close`/`ack`/`output`/`replay`/`exit`/`error` protocol. Routes are namespaced under the extension id so extensions cannot collide.

5. **Terminal session model (from spec).** A session = PTY + ring buffer (last 1 MB / ~5,000 lines) + owner login, identified by random `sid`. `open` with an existing `sid` sends `replay` then live output; a WebSocket close does not kill the PTY (detach); idle reaping after 24 hours (configurable); explicit `close` kills the PTY; max 8 sessions per user; `$SHELL` login shell, `TERM=xterm-256color`, configurable working directory; optional `tmux` for stronger persistence.

6. **Terminal reachability.** Entry points: Dashboard card, `ChatList` sidebar item, keyboard shortcut, and "Open terminal" action available from any chat's header/actions (passes that chat's `cwd` as the terminal's start directory). URL `?terminal=<sid>` opens/reattaches that tab.

7. **Security boundary.** The terminal WebSocket upgrade runs the same `authorize(request, { allowedLogin, origins, token })` check as the chat WebSocket, before any PTY is created. The extension backend routes are wrapped by the host's auth middleware, so an extension cannot bypass identity or origin checks. Shell runs as unprivileged user; `process.env` is not passed wholesale.

8. **Extension discovery & loading.** Startup scan of `extensions/` (one folder per extension). Load order is manifest order; on failure, log and skip that extension (do not fail startup). Each extension's backend code runs in the host process; each extension's frontend code is bundled with the app at build time via a Vite plugin or an import-map generated from `extensions/`.

9. **No extension code in host.** `src/` contains no terminal-specific code. The terminal lives entirely under `extensions/terminal/`. The host contains only the registry + SDK.

10. **Scaffolding.** `remote-agent extension:new <id>` (or a script) creates `extensions/<id>/` with `plugin.json`, frontend entry, backend entry, and a README, wired into the build.

## UI and visual consistency

The terminal section must look like it belongs in this app, not like an xterm.js demo dropped in. It follows the existing layout and token system exactly.

**Layout pattern.** When `?terminal=<sid>` is active, the main area renders a terminal section the same way `Dashboard` replaces `MessageFeed` for General: the `ChatList` sidebar stays, and the main area renders a terminal header + tab bar + xterm.js viewport + status bar. Navigation uses the same `openTerminal(sid)` style as `openChat(chatId)`; switching sections updates the URL via `history.pushState`.

**Terminal header.** Left: back arrow and "Terminal" title. Center: tab strip — one tab per active `sid`, each with its short label and a close ×, plus a "+ New terminal" button. Right: info/settings affordances. Matches `ChatHeader` in shape and density.

**xterm.js viewport.** Fills remaining height via `addon-fit` and a debounced `ResizeObserver`, exactly per the spec. Foreground, background, cursor, and selection colors are set from the app's CSS custom properties (`--foreground`, `--background`, `--primary`, `--accent`) so the terminal re-colors with theme, palette, accent, and dark/light mode. Font is `IBM Plex Mono` (already loaded globally), respecting `preferences.density` for padding and line-height.

**Bottom status bar.** Thin bar per tab: `sid`, owner login, working directory, connection-status dot (connected / reconnecting / error), and bytes in/out. Reuses `rounded-xl`/`shadow-sm`/`ring-1 ring-border/60` card styling and the `Text`-sized muted foreground.

**Connection state.** Reuses the chat's connection-notice banner pattern: amber dot + "Reconnecting…" / red dot + "Connection lost" + Retry button. Because sessions survive reloads (reattach + `replay`), the UI never pretends a dead socket killed the shell; it reconnects with backoff and replays the buffer.

**Empty state.** No terminals: centered "No terminal sessions" + one-line explanation + "Start terminal" button, mirroring the current empty-chat state in `app.tsx`.

**Text sketch:**

```
┌─────────────────────────────────────────────────────────────┐
│ ◀ Terminal                        ● server.production     │
│  [session-a] [session-b] [+ New]   ⋮                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  $ bun run dev                                              │
│  [12:04:01] vite v6.2.0 building...                         │
│  [12:04:05] ✓ built in 840ms                                │
│  $                                                          │
│                                                             │
│  (xterm.js viewport — fills remaining height)               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ session-a · login: zafar · cwd: ~/projects/app · 12 KB ↕   │
└─────────────────────────────────────────────────────────────┘
```

Empty state:
```
    No terminal sessions

    Open a shell over Tailscale. Sessions survive reloads.

    [ Start terminal ]
```

**UI decisions for the builder:** tab close behavior (close tab = send `close` and kill PTY), whether the tab strip scrolls when many tabs are open, and whether the status bar shows CPU/memory per session. (Minor — I'll close a tab by killing its PTY, scroll the tab strip, and skip per-session CPU/memory in v1.)

## Flow

1. User opens the web app over Tailscale. Bridge starts, scans `extensions/`, loads `terminal` plugin, calls its `onActivate`.
2. User clicks "Open terminal" (from dashboard, sidebar, or a chat). App opens `?terminal=<newSid>`, `ExtensionRegistry` renders the terminal panel.
3. Terminal panel (xterm.js) connects to the terminal WebSocket route, sends `open { sid, cols, rows }`.
4. Host auth-checks the upgrade (Tailscale identity + `Origin`), the terminal plugin creates/reattaches the PTY for `sid`, sends `replay` buffer, then streams `output`.
5. User types: `input` → WebSocket → PTY master → shell. Shell output → `output` → xterm.js. Resize sends `resize`; flow control uses `ack`.
6. On reload, user reconnects with backoff and `open` the same `sid` to get `replay` + live output. On explicit `close`, PTY is killed. Idle sessions reaped after 24h.

## File layout (new)

```
extensions/
  terminal/
    plugin.json
    README.md
    frontend/
      TerminalPanel.tsx        # xterm.js tab UI + tabs + fit/webgl/addons
      index.ts                 # panel registration entry
    backend/
      pty.ts                   # node-pty session manager, ring buffer, reattach
      index.ts                 # backend registration entry (WS route)
src/
  ui/
    components/
      extension-registry.tsx   # renders contributed panels as tabs
      terminal-tab.tsx         # thin host wrapper around extension panel (optional)
    app.tsx                    # ExtensionRegistry + ?terminal route
  extension-sdk/
    index.ts                   # @remote-agent/extension-sdk (frontend + backend slices)
  channel/web/
    server.ts                  # unchanged; extensions register routes via hook
```

I will not commit `extensions/terminal/` code until this design is approved.

## What's left to the builder

These are open; I'll settle the minor ones myself and bring the rest to you:

- **Manifest validation strictness:** which `permissions` values exist beyond `pty` and `websocket-routes`, and whether `frontend.entry`/`backend.entry` are enforced as relative paths. (Minor — I'll set `pty`, `websocket-routes`, `http-routes` and relative-path enforcement.)
- **Frontend bundling of extensions:** Vite plugin vs. generated import map vs. requiring extensions to be pre-bundled. (Theirs — changes how extensions are authored and built; needs your call.)
- **Extension permissions model:** whether `permissions` is merely declarative (logged) or enforced by the host (e.g. an extension without `pty` cannot import node-pty). (Theirs — enforcement needs a decision on how much host surface to expose.)
- **Terminal working directory default:** configurable working directory default (home vs. a trusted folder vs. last used). (Theirs.)
- **tmux inside PTY:** optional per spec; whether to enable by default. (Theirs.)
- **Idle reaping default:** 24 hours per spec; whether to make configurable. (Minor — I'll set configurable with default 24h.)

## Calls I made (for your review while reading)

- Approach B: terminal is its own section, not inside a chat.
- Approach 1: in-process extension host (best DX for VS Code/WordPress-style plugins).
- One folder per extension under `extensions/`, discovered at startup, no runtime install.
- `plugin.json` manifest with `id`, `name`, `version`, `frontend.entry`, `backend.entry`, `permissions`.
- Terminal protocol and session model carried over unchanged from the attached spec.
- All security requirements from the spec applied to extension routes via the host's existing `authorize` middleware.

Nothing gets built until you approve this doc. Say so, or tell me what to change, and I'll move to the plan (writing-plans) next.
