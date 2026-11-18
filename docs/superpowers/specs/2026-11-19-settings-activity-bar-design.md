# Settings in the activity bar: design

Date: 2026-11-19
Status: draft, waiting for approval. Nothing is built yet.

## Intent

Settings are spread over a gear button in the chat header and one long dialog. The dialog mixes appearance, chat behaviour and notifications in a single scroll, and there is no way to find one setting without reading them all. Move settings into the activity bar as their own tab, after the extension tabs. The side panel lists the setting groups and a search field. Picking a group shows its settings in the main area. Search finds any setting by name or keyword across groups.

## Goals

- A Settings tab in the activity bar, always last, after Chats and every extension tab.
- The side panel shows the groups and a search field.
- Selecting a group shows that group's settings in the main area, with the same controls and behaviour as today.
- Search matches setting titles, descriptions and keywords across all groups. A result opens its group in the main area and brings that setting into view.
- Three groups: Appearance, Chat, Notifications & presence.
- The gear button and the settings dialog are removed. The Settings tab is the only place for settings (no duplication).
- The UI uses the existing vocabulary: `SidePanelFrame`, the search bar style, the segmented control, the switch, `SettingLabel`, `Separator`, and `Button`.

## Non-goals

- No new settings. Every setting in the dialog today moves; nothing is added or removed.
- No change to what a setting does or how it is stored. Preferences stay in `preferences.ts` (on this device). Away mode stays server state. Push stays the device's push subscription.
- No URL state for the selected group or the search.
- No change to the extension side-tab API.

## Anti-goals

- Settings must not become a second list of extension contributions. Extensions do not add settings in this change; the registry is host-owned.
- The main area must not hide an open chat's state. Leaving settings returns to the chat as it was.

## Constraints

- The activity bar is a 52px column on desktop and a bottom bar on phones. One more tab shares the phone bar's width, so labels must still fit at 360px.
- The main area today shows a chat or an extension panel. Settings is a third thing it can show.
- Preferences are read and written through `localStorage` with try/catch. The settings view must keep that behaviour.

## Approaches

1. **Chosen: host-owned settings view, with groups in the side panel.** The side tab renders the group list and search. Selecting a group sets a host state (`settingsGroup`) that the main area renders as the settings view. The settings are data (`settings-registry.ts`), so search is a plain filter over that data. Controls are the ones the dialog already uses.
2. Rejected: the full settings inside the side panel, with the main area as a detail pane. This makes the narrow side panel hold controls (theme swatches, accent dots, the font preview), which are too wide for it, and duplicates the layout the main area already gives.
3. Rejected: keep the dialog and add a tab that opens it. This keeps the dialog's single long scroll, which is the problem being fixed, and leaves two entry points.
4. Rejected: register Settings through `registerSideTab`. Settings is host-owned and needs the main area, which the side-tab API does not reach.

## Layout

Desktop (md and up): the activity bar gets a last gear icon. Selecting it replaces the side panel content with the settings list.

```
┌──┬──────────────┬──────────────────────────────┐
│💬│ Settings     │ Appearance                   │
│🖥│ 🔍 Search…   │  Theme      [Light|Dark|Sys] │
│⚙ │ ▸ Appearance │  Color theme  (grid)         │
│  │ ▸ Chat       │  Accent     ● ● ● ● ● ● ●    │
│  │ ▸ Notifs     │  Density    [Compact|Comf.]  │
└──┴──────────────┴──────────────────────────────┘
```

Search: the list is replaced by results, each showing the setting's title, its group name and a one-line description. Picking one opens the group and scrolls to the setting. An empty result says "No settings match …".

Phone (below md): the side column fills the screen as today. Picking a group opens the main area, which covers the side column as a chat does. The main area has a back control that returns to the group list.

## Groups and settings

- **Appearance:** Theme (light, dark, system), Color theme, Accent, Glow (accent light in chat), Density, Chat font size, with the preview line under the font size.
- **Chat:** Enter in chat (sends or new line), Long lines in code blocks (scroll or wrap).
- **Notifications & presence:** Away mode (switch), Push notifications (enable or on, with the iOS Home Screen notice).

Each setting is a registry entry: `id`, `group`, `title`, `description`, `keywords`, and a control. Search matches `title`, `description` and `keywords`.

## Calls made by me

- Groups and their order are my proposal, as shown above. Correct them in review.
- The settings view opens on Appearance, the first group. The last group visited is not remembered, so every visit starts at the group list.
- The search query is not kept when the tab is left.
- The General view preference (`generalView`) is not in the dialog today, so it is not in Settings. It has its own control where it is set now. Moving it would be a change of where things live, which this design does not make.
- Opening a chat or an extension panel from the main area replaces the settings view. Selecting Settings again returns to the group last shown.
- The settings view is a main-area view, so its state is one value the main area chooses from: a chat, an extension panel, or settings. Only one shows.
- The Settings tab is always shown, as the Terminal tab is.

## Parts

- `src/ui/settings/settings-registry.ts`: the groups and the setting definitions. Pure data, no React.
- `src/ui/settings/settings-search.ts`: the search filter over the registry (pure, testable).
- `src/ui/components/settings/SettingsSidePanel.tsx`: the side tab content (search field, group list, results).
- `src/ui/components/settings/SettingsView.tsx`: the main-area view for one group, rendering its settings with the controls.
- `src/ui/components/settings/settings-controls.tsx`: `SettingLabel`, `SettingSegments`, the switch, the accent and theme swatches, moved out of `settings-dialog.tsx`.
- `src/ui/components/side-panel/side-tab.ts`: adds the Settings tab id as a known id, after the extension ids.
- `src/ui/components/side-panel/SidePanel.tsx`: drops the gear button and its `onSettings` prop.
- `src/ui/app.tsx`: owns `settingsGroup`, adds the Settings tab after the extension tabs, and renders `SettingsView` in the main area. The `SettingsDialog` render and `settingsOpen` state are removed.
- `src/ui/components/settings-dialog.tsx`: deleted once its content moves.

## What's left to the builder

- Exact icon for the tab and the group rows (a gear for the tab; a per-group icon for each row is up to the builder).
- How the main area scrolls a search result into view (scrolling the element into view, with a short highlight, is enough).
- The exact spacing and type sizes, using the classes the dialog and chat list already use.
- Tests: a unit test for the search filter; a test that every registry entry has a known group and a unique id; a render test that selecting a group shows its settings; a check at 360px width that the phone bar's labels fit.
