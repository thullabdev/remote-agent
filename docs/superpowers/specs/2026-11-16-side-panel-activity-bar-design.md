# Side panel activity bar: design

Date: 2026-11-16
Status: approved in conversation (the activity bar's phone placement was changed to a bottom bar at the user's suggestion)

## Intent

The left column only shows chats. Extensions should be able to own a whole side view, the way VS Code lets an extension own a side bar view. The terminal extension is the first: it gets its own tab with an icon, and its own list replaces the chat list while its tab is open.

## Goals

- A tab strip for the side column. Chats is always a tab. Each extension can register one more tab with a title and an icon.
- Selecting a tab replaces the whole side panel content with that tab's render. The extension draws its own header, list and empty state.
- The terminal list moves out of the chat list into the terminal tab.
- The selected tab is remembered on this device.

## Non-goals

- No change to chat list behaviour, filters, search or selection.
- No URL state for the selected tab.
- No change to the main area. Selecting a tab does not close the open chat or panel.

## Anti-goals

- The chat list must not get a second way for extensions to add content (the old `registerSidebarSection` goes away, so there is one slot).

## Approach (chosen)

Extend `src/ui/extension-slots.ts` with `registerSideTab(id, { title, icon, render })`. The host renders the tabs from that registry. Chats is a built-in tab placed first. The host keeps the selected tab id in state and in `localStorage` (try/catch, as preferences do).

Rejected: putting the tab in the URL (no value for a side column); keeping `registerSidebarSection` alongside tabs (two ways to add to the column).

## Layout

Desktop (md and up): a 52px icon strip on the far left, then the side panel as today.

```
┌──┬──────────────┬───────────────────────┐
│💬│ Chats        │  main area            │
│🖥│  search…     │                       │
└──┴──────────────┴───────────────────────┘
```

Phone (below md): the side column fills the screen as today, and the tabs form a bottom navigation bar, with an icon and a label per tab. The bar is shown only while the side column is shown (no chat or panel open), since the main area covers it otherwise. The new-session round button sits above the bar.

## Calls made by me

- The Terminal tab is always shown. When no shells are open, it shows an empty state that says where to start one.
- Selecting a tab keeps the open chat or panel as it is.
- The selected tab falls back to Chats when the stored id is not registered.
- Tab ids are unique; registering the same id replaces the tab (as the other slots do).

## Parts

- `src/ui/extension-slots.ts`: `SideTabContext`, `registerSideTab`, `sideTabs()`; `registerSidebarSection` and `sidebarSections` are removed.
- `src/ui/components/side-panel/side-tab.ts`: read and write the remembered tab (injected storage, testable).
- `src/ui/components/side-panel/ActivityBar.tsx`: the tab buttons; a vertical strip on desktop, a bottom bar on phones.
- `src/ui/components/side-panel/SidePanelFrame.tsx`: the aside, width and resize handle shared by every side tab.
- `src/ui/components/side-panel/SidePanel.tsx`: the chat tab's content (no `sidebarSections` prop).
- `src/ui/app.tsx`: owns the selected tab, renders the column, and passes the extension's tab render.
- `extensions/terminal/frontend/surfaces.tsx` and `index.tsx`: the terminal side tab replaces the sidebar section.

## Left to the builder

- Exact icon for Chats (use `MessageSquareText`, which the empty state already uses).
- Exact pixel widths, as long as the strip stays narrow and the phone bar respects the bottom safe area.
