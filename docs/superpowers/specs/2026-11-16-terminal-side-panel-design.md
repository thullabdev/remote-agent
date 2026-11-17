# Terminal in the side panel: design

Date: 2026-11-16
Status: approved in conversation (the four open questions and the details were agreed)
Builds on: `2026-11-16-side-panel-activity-bar-design.md`

## Intent

The terminal lives in the side panel, not the main area. Its tab holds the shells and the emulator, so a person can keep a shell beside the chat they are reading.

## Goals

- The terminal registers only a side tab. It no longer registers a main-area panel.
- Its header says "Terminal". On large screens an add button sits at the right of the header. On phones the add button is a floating button above the bottom bar.
- Add starts a shell in the active chat's folder and links it to that chat. With no chat folder, add shows a picker of trusted projects.
- A row of tab pills lists the open shells. The row is hidden when there is only one shell.
- A pill's title is `<last folder of launch cwd> • <foreground command>`. When the shell is idle the foreground command is the shell's own name (for example `zsh`).
- The side tab's extension context knows the active chat.

## Non-goals

- No change to the shell lifecycle: limits, idle reaping, reconnect and close behaviour stay as they are.
- No per-project grouping of pills. All open shells are shown.

## Calls made by me

- **Active chat on phones.** On a phone the column is hidden while a chat is open, so the terminal tab can only be seen with no chat open. The context chat is therefore the chat that is open, or else the one most recently open. Without this, add on a phone would always show the picker.
- **Foreground command source.** One `tmux list-panes -a` call every 2 seconds gives the foreground command of every shell. The server publishes the list when a command changes. Changes show within about 2 seconds, not instantly.
- **Old links.** `?panel=terminal` opens the Terminals tab. The `sid` parameter is ignored.
- **Selection.** The selected shell is remembered in the terminal extension's store. When it closes, the newest remaining shell is selected.
- **Pills and close.** Each pill keeps a close control, as it does now.

## Parts

- Backend: `tmux.ts` (`foregroundCommands`), `routes.ts` (`SessionView.command`, `viewOf`), `index.ts` (command poll, publish on change).
- Host: `extension-slots.ts` (`activeChat` in `SideTabContext`, `openSideTab` in dashboard and chat-action contexts), `app.tsx` (context chat, `openSideTab`, the initial tab from `panel=terminal`).
- Terminal frontend: `store.ts` (selection, `command`), `actions.ts` (add, open for chat), `surfaces.tsx` (side tab, dashboard card, chat action), `TerminalPanel.tsx` (emulator viewport, pill row, folder picker), `index.tsx` (registration only).
