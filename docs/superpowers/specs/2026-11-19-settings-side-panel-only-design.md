# Settings in the side panel only: design

Date: 2026-11-19
Status: approved in conversation. Supersedes the main-area parts of `2026-11-19-settings-activity-bar-design.md`.

## Intent

Settings belong in the side panel with the other side tabs. A main-area settings page splits one task across two columns and adds a Back control that exists only to get back out. Keep every setting in the side panel, grouped and collapsible, so the settings page can be dropped.

## Goals

- All settings render in the side panel under the Settings tab.
- Each group is a collapsible section, expanded by default.
- The search field and the group headers stay fixed at the top of the panel. Only the settings below them scroll.
- Searching keeps the matching settings in their groups, with their controls. Groups with no matches are hidden, and groups that remain are expanded.
- The main area shows only chats and extension panels, as before the Settings tab existed.

## Non-goals

- No change to what a setting does or how it is stored.
- No change to the registry's settings or groups, beyond what this design lists.

## Anti-goals

- Settings must not open anything in the main area.
- A search must not replace the group layout with a flat list of results.

## Constraints

- The side panel is resizable, between 260px and 560px wide (default 352px). Every control must fit at 260px: the accent row of seven swatches and the two-column color theme grid are the widest.
- On a phone the side column fills the screen. The bottom tab bar switches tabs as before.

## Approaches

1. **Chosen: all controls inside the side panel.** `SettingsSidePanel` renders the search header, then a scrolling body with one collapsible section per group. Each section holds that group's settings, rendered with the controls from `settings-controls.tsx`. The main-area view and its state are removed.
2. Rejected: keep the main-area page and add a collapsible list beside it. This keeps the split the change is meant to remove.
3. Rejected: a flat list of results when searching. It loses the group each setting belongs to.

## Calls made by me

- Collapsed state is held in the panel and is not remembered between visits.
- Each group header shows its title and description, with a chevron that turns when the group opens or closes. It is a button with `aria-expanded`.
- While a search is active, every remaining group is expanded, so no match is hidden behind a collapsed header.
- Search matches a setting's title, description and keywords, as it does now.
- Amended after review: no result-selection scroll or highlight. Matches show in place in their groups, so there is no separate result to select. The earlier goal and tests for selecting a result are dropped.
- The Back button and the `onBack` prop are removed with the main-area view.

## Parts

- `src/ui/components/settings/SettingsSidePanel.tsx`: the fixed header (search field), the scrolling body, one collapsible section per group and search filtering.
- `src/ui/components/settings/SettingsView.tsx`: removed. Its per-setting rendering moves into `SettingsSidePanel.tsx` or a sibling `SettingsSection.tsx`.
- `src/ui/app.tsx`: drops the `settingsView` state and the settings branch of the main area. `openSettings` is no longer needed; the side tab renders the panel directly.
- `src/ui/shell/MainArea` usage: `shown` returns to `activeChatId !== null || activePanel !== null`.

## What's left to the builder

- The exact collapse animation, if any. A plain show/hide is enough.
- Styling for the group header, which should match the side panel's existing row style.
- Tests: rendering with groups expanded by default; collapsing hides a group's settings; searching keeps matches in their groups and hides empty groups; the header and search field sit outside the scrolling body; a check that every control fits at 260px.
