# Settings in the side panel only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every setting inside the side panel as collapsible groups, with a fixed search field, and remove the main-area settings view.

**Architecture:** The side panel owns all settings UI. `SettingsSidePanel` holds the search query and each group's open state, and renders one `SettingsGroup` section per group. A pure function, `groupsForView`, decides which groups and settings show for a query and open state. Per-setting rendering moves to `settings-rows.tsx`. `app.tsx` stops holding a settings view.

**Tech Stack:** React, TypeScript, Tailwind classes, lucide-react icons, bun test with `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-11-19-settings-side-panel-only-design.md` (and the earlier `docs/superpowers/specs/2026-11-19-settings-activity-bar-design.md` for the registry and controls)

## Global Constraints

- Settings never open anything in the main area. The main area shows only chats and extension panels.
- Group order: `Appearance`, `Chat`, `Notifications & presence`. Setting ids and their stored preferences do not change.
- The search field and its header sit outside the scrolling body. Only the settings body scrolls.
- Group headers are sticky within the scrolling body, so a header stays visible while its settings scroll. The design's word "fixed" means this.
- While a search is active, every group with a match is expanded and no group can be collapsed.
- Collapsed state is held in the panel and is not stored.
- Controls must fit a 260px-wide panel without horizontal scrolling.

## Review Focus

1. A query that matches no setting shows the empty message, not a blank panel. Test in Task 4.
2. A query with regex characters (`(`, `*`) is matched as plain text and does not throw. Test in Task 2 (already in `settings-search.test.ts`).
3. Collapsing a group, then searching, then clearing the search: the group returns collapsed. Test in Task 2.
4. A search that leaves a group with no matches hides that group entirely. Test in Task 2.
5. The seven accent swatches wrap rather than overflow a 260px panel. Test in Task 1.

---

### Task 1: Setting rows, and accent swatches that wrap

**Files:**
- Create: `src/ui/components/settings/settings-rows.tsx`
- Modify: `src/ui/components/settings/settings-controls.tsx` (the `AccentSwatches` container)
- Delete: `src/ui/components/settings/SettingsView.tsx`, `test/ui/settings-view.test.tsx`
- Test: `test/ui/settings-rows.test.tsx`

**Interfaces:**
- Consumes: `SettingDefinition` from `src/ui/settings/settings-registry.ts`; `Preferences` from `src/ui/preferences.ts`; `PushStatus` from `src/ui/use-push-subscription.ts`; the controls in `settings-controls.tsx`.
- Produces:
  ```ts
  export type SettingsContext = {
    preferences: Preferences
    onPreferences(preferences: Preferences): void
    away: boolean
    onAwayToggle(): void
    push: PushStatus
    pushBusy: boolean
    onPushToggle(): void
  }
  export function SettingRow(props: { setting: SettingDefinition; context: SettingsContext }): JSX.Element
  ```
  `SettingRow` renders `<section data-setting={setting.id} className="rounded-2xl">` around the control for that setting. The control rendering is the `renderSetting` switch and `PushSetting` from the deleted `SettingsView.tsx`, moved unchanged except that they read from `context`.

- [ ] **Step 1: Write the failing test**

Create `test/ui/settings-rows.test.tsx`:

```tsx
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SETTINGS } from '../../src/ui/settings/settings-registry.ts'
import { SettingRow, type SettingsContext } from '../../src/ui/components/settings/settings-rows.tsx'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const context: SettingsContext = {
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: false, subscribed: false, permission: 'unsupported', iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}

describe('SettingRow', () => {
  it('renders a row for every setting', () => {
    for (const setting of SETTINGS) {
      expect(renderToStaticMarkup(<SettingRow setting={setting} context={context} />)).toContain(`data-setting="${setting.id}"`)
    }
  })

  it('shows the Web Push explanation when the browser lacks it', () => {
    const push = SETTINGS.find(setting => setting.id === 'pushNotifications')!
    expect(renderToStaticMarkup(<SettingRow setting={push} context={context} />)).toContain('does not support Web Push')
  })

  it('wraps the accent swatches so they fit a 260px panel', () => {
    const accent = SETTINGS.find(setting => setting.id === 'accent')!
    expect(renderToStaticMarkup(<SettingRow setting={accent} context={context} />)).toContain('flex-wrap')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-rows.test.tsx`
Expected: FAIL with "Cannot find module" for `settings-rows.tsx`.

- [ ] **Step 3: Implement**

Create `settings-rows.tsx`: move the `renderSetting` switch and `PushSetting` from `SettingsView.tsx`, renamed to take `context` (the fields are the same names as in `SettingsContext`), wrapped in `SettingRow`. Keep all markup, including the `fontSize` preview line, unchanged. In `settings-controls.tsx`, change the `AccentSwatches` container from `flex gap-3` to `flex flex-wrap gap-3`. Delete `SettingsView.tsx` and `test/ui/settings-view.test.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-rows.test.tsx && bun run typecheck`
Expected: PASS, typecheck clean. (The side panel and app still import `SettingsView`; they are updated in Tasks 4 and 5, so run the full suite only after Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/settings-rows.tsx src/ui/components/settings/settings-controls.tsx test/ui/settings-rows.test.tsx
git rm -q src/ui/components/settings/SettingsView.tsx test/ui/settings-view.test.tsx
git commit -m "refactor(settings): move setting rows into the side panel module"
```

---

### Task 2: The view model for groups and search

**Files:**
- Modify: `src/ui/settings/settings-search.ts`
- Test: `test/ui/settings-search.test.ts`

**Interfaces:**
- Consumes: `SETTINGS`, `SETTING_GROUPS`, `SettingDefinition`, `SettingGroupId` from `settings-registry.ts`; `searchSettings` in the same file.
- Produces:
  ```ts
  export type GroupOpenState = Readonly<Record<SettingGroupId, boolean>>
  export type GroupView = {
    group: SettingGroupId
    title: string
    description: string
    settings: SettingDefinition[]
    /** True while a search is active: the group is expanded and cannot be collapsed. */
    searching: boolean
    open: boolean
  }
  export function groupsForView(query: string, open: GroupOpenState): GroupView[]
  ```
  With a blank query: one view per group in `SETTING_GROUPS` order, with all its settings, `searching: false`, `open: open[group]`. With a non-blank query: only groups that have at least one match, with only the matching settings, `searching: true`, `open: true`. The group open state is untouched by search.

- [ ] **Step 1: Write the failing test**

Append to `test/ui/settings-search.test.ts`:

```ts
import { groupsForView, type GroupOpenState } from '../../src/ui/settings/settings-search.ts'

const allOpen: GroupOpenState = { appearance: true, chat: true, notifications: true }

describe('groupsForView', () => {
  it('shows every group with all its settings when nothing is searched', () => {
    const views = groupsForView('', allOpen)
    expect(views.map(view => view.group)).toEqual(['appearance', 'chat', 'notifications'])
    expect(views[1]!.settings.map(setting => setting.id)).toEqual(['enter', 'codeWrap'])
    expect(views.every(view => view.searching === false)).toBe(true)
  })

  it('keeps a collapsed group collapsed when nothing is searched', () => {
    const views = groupsForView('', { ...allOpen, chat: false })
    expect(views.find(view => view.group === 'chat')!.open).toBe(false)
  })

  it('shows only matching settings, in their groups, expanded while searching', () => {
    const views = groupsForView('accent', { ...allOpen, appearance: false })
    expect(views.map(view => view.group)).toEqual(['appearance'])
    expect(views[0]!.settings.map(setting => setting.id)).toEqual(['accent'])
    expect(views[0]!.searching).toBe(true)
    expect(views[0]!.open).toBe(true)
  })

  it('hides groups with no match', () => {
    const views = groupsForView('web push', allOpen)
    expect(views.map(view => view.group)).toEqual(['notifications'])
  })

  it('returns the group collapsed again once the search is cleared', () => {
    const collapsed: GroupOpenState = { ...allOpen, chat: false }
    expect(groupsForView('enter', collapsed).find(view => view.group === 'chat')!.open).toBe(true)
    expect(groupsForView('', collapsed).find(view => view.group === 'chat')!.open).toBe(false)
  })

  it('returns no groups for a query that matches nothing', () => {
    expect(groupsForView('zebra', allOpen)).toEqual([])
  })

  it('treats regex characters as plain text', () => {
    expect(() => groupsForView('(', allOpen)).not.toThrow()
    expect(groupsForView('*', allOpen)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-search.test.ts`
Expected: FAIL: `groupsForView` is not exported.

- [ ] **Step 3: Implement**

Add the types and `groupsForView` to `settings-search.ts` as listed under Interfaces. Use `searchSettings(query)` for the matches when the query is non-blank, and `settingsIn` order from `SETTINGS` for the blank case. Filter `SETTING_GROUPS` in order, dropping groups with no settings in the view.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-search.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings/settings-search.ts test/ui/settings-search.test.ts
git commit -m "feat(settings): derive the visible groups from the query and open state"
```

---

### Task 3: The collapsible group section

**Files:**
- Create: `src/ui/components/settings/SettingsGroup.tsx`
- Test: `test/ui/settings-group.test.tsx`

**Interfaces:**
- Consumes: `GroupView` from `settings-search.ts`; `SettingRow` and `SettingsContext` from `settings-rows.tsx`; `SettingGroupId` from the registry; `ChevronDown` (or `ChevronRight`) and the group icons (`Palette`, `MessageSquareText`, `Bell`) from lucide-react.
- Produces:
  ```ts
  export function SettingsGroup(props: { view: GroupView; context: SettingsContext; onToggle(group: SettingGroupId): void }): JSX.Element
  ```
  Renders `<section data-group={view.group}>` containing a sticky header and the body. The header is a `<button type="button" aria-expanded={view.open} aria-controls={`settings-group-${view.group}`}>` when `view.searching` is false, and a plain `<div>` when it is true. The body (`id={`settings-group-${view.group}`}`) renders one `SettingRow` per setting when `view.open` is true, and nothing when false. The header has the group's icon tile, title and description, and a chevron that rotates when open. The header carries `sticky top-0 z-10 bg-background`. The group icons map is `{ appearance: Palette, chat: MessageSquareText, notifications: Bell }`, defined in this file.

- [ ] **Step 1: Write the failing test**

Create `test/ui/settings-group.test.tsx`:

```tsx
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsGroup } from '../../src/ui/components/settings/SettingsGroup.tsx'
import type { SettingsContext } from '../../src/ui/components/settings/settings-rows.tsx'
import { groupsForView } from '../../src/ui/settings/settings-search.ts'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const context: SettingsContext = {
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: true, subscribed: false, permission: 'default', iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}
const open = { appearance: true, chat: true, notifications: true }
const view = (group: 'appearance' | 'chat' | 'notifications', query = '', state = open) => groupsForView(query, state).find(item => item.group === group)!

describe('SettingsGroup', () => {
  it('is expanded by default and shows its settings', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat')} context={context} onToggle={() => {}} />)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-setting="enter"')
    expect(html).toContain('data-setting="codeWrap"')
  })

  it('hides its settings when collapsed, and says so', () => {
    const html = renderToStaticMarkup(
      <SettingsGroup view={view('chat', '', { ...open, chat: false })} context={context} onToggle={() => {}} />,
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('data-setting="enter"')
  })

  it('keeps its header sticky inside the scrolling body', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat')} context={context} onToggle={() => {}} />)
    expect(html).toMatch(/<button[^>]*sticky top-0/)
  })

  it('is not a toggle while a search is active', () => {
    const html = renderToStaticMarkup(<SettingsGroup view={view('chat', 'enter')} context={context} onToggle={() => {}} />)
    expect(html).not.toContain('aria-expanded')
    expect(html).toContain('data-setting="enter"')
    expect(html).not.toContain('data-setting="codeWrap"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-group.test.tsx`
Expected: FAIL with "Cannot find module" for `SettingsGroup.tsx`.

- [ ] **Step 3: Implement**

Create `SettingsGroup.tsx` as listed under Interfaces. The header button uses `w-full`, `flex items-center gap-3 px-3 py-3.5 text-left`, and the icon tile `grid size-10 shrink-0 place-items-center rounded-xl bg-muted`. The body is `div` with `space-y-3 px-1 pb-3`, rendering `SettingRow` per setting.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-group.test.tsx && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/SettingsGroup.tsx test/ui/settings-group.test.tsx
git commit -m "feat(settings): add the collapsible settings group"
```

---

### Task 4: The side panel: fixed search, scrolling groups

**Files:**
- Modify: `src/ui/components/settings/SettingsSidePanel.tsx` (rewrite)
- Test: `test/ui/settings-side-panel.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `SettingsContext` from `settings-rows.tsx`; `groupsForView`, `GroupOpenState` from `settings-search.ts`; `SettingsGroup` from `SettingsGroup.tsx`; `SidePanelFrame`; `Input`.
- Produces:
  ```ts
  export type SettingsSidePanelProps = {
    context: SettingsContext
    /** The search the panel opens with. Empty, unless a test says otherwise. */
    initialQuery?: string
  }
  export function SettingsSidePanel(props: SettingsSidePanelProps): JSX.Element
  ```
  The panel renders `SidePanelFrame label="Settings"`, a header containing the search `Input` (`aria-label="Search settings"`) and its clear button (`aria-label="Clear search"`, shown while the query is non-empty), then a body `div` with `min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:pb-24`. The body holds one `SettingsGroup` per entry from `groupsForView(query, open)`, or the empty message `No settings match &ldquo;<query>&rdquo;.` when that list is empty. Open state starts as `{ appearance: true, chat: true, notifications: true }`. `onToggle` flips the stored state for that group. The search query is local state and is not kept when the tab is left.

- [ ] **Step 1: Write the failing test**

Replace `test/ui/settings-side-panel.test.tsx` with:

```tsx
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSidePanel } from '../../src/ui/components/settings/SettingsSidePanel.tsx'
import type { SettingsContext } from '../../src/ui/components/settings/settings-rows.tsx'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const context: SettingsContext = {
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: true, subscribed: false, permission: 'default', iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}

describe('SettingsSidePanel', () => {
  it('shows every group expanded by default, with its settings', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} />)
    expect(html).toContain('Appearance')
    expect(html).toContain('Notifications &amp; presence')
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3)
    expect(html).toContain('data-setting="theme"')
    expect(html).toContain('data-setting="pushNotifications"')
  })

  it('keeps the search field and its header outside the scrolling body', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} />)
    const headerEnd = html.indexOf('</header>')
    expect(headerEnd).toBeGreaterThan(-1)
    expect(html.indexOf('aria-label="Search settings"')).toBeLessThan(headerEnd)
    expect(html.indexOf('overflow-y-auto')).toBeGreaterThan(headerEnd)
  })

  it('shows only the matching settings while searching', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} initialQuery="accent" />)
    expect(html).toContain('data-setting="accent"')
    expect(html).not.toContain('data-setting="theme"')
    expect(html).not.toContain('Notifications &amp; presence')
  })

  it('shows the clear button only while there is a query', () => {
    expect(renderToStaticMarkup(<SettingsSidePanel context={context} initialQuery="accent" />)).toContain('aria-label="Clear search"')
    expect(renderToStaticMarkup(<SettingsSidePanel context={context} />)).not.toContain('aria-label="Clear search"')
  })

  it('says so when nothing matches', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel context={context} initialQuery="zebra" />)
    expect(html).toContain('No settings match')
    expect(html).toContain('zebra')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-side-panel.test.tsx`
Expected: FAIL: the current panel takes `onOpen`, not `context`, and renders no settings rows.

- [ ] **Step 3: Implement**

Rewrite `SettingsSidePanel.tsx`: keep the existing header markup (search `Input`, clear button, `h-[4.25rem]` header) and the existing `SidePanelFrame`. Replace the body with the mapping over `groupsForView(query, open)` to `SettingsGroup`, using `context` and an `onToggle` that flips `open[group]`. Keep the empty message unchanged. Remove the `onOpen` prop, the group-row buttons, `GROUP_ICONS`, and `SETTING_GROUPS` imports that are no longer used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-side-panel.test.tsx && bun run typecheck`
Expected: PASS, typecheck clean. (`app.tsx` still passes `onOpen`, so typecheck fails until Task 5; run the typecheck after Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/SettingsSidePanel.tsx test/ui/settings-side-panel.test.tsx
git commit -m "feat(settings): render every group in the side panel with a fixed search"
```

---

### Task 5: Remove the main-area settings view from the app

**Files:**
- Modify: `src/ui/app.tsx`

**Interfaces:**
- Consumes: `SettingsSidePanel` (Task 4) with `context`.
- Produces: none. The side column's Settings branch renders `<SettingsSidePanel context={...} />`, where `context` is `{ preferences, onPreferences: setPreferences, away: realtime.away, onAwayToggle: toggleAway, push: push.status, pushBusy: push.busy, onPushToggle: togglePush }`.

- [ ] **Step 1: Write the failing check**

Run: `grep -n "settingsView\|SettingsView\|setSettingsView" src/ui/app.tsx`
Expected: matches present (this is the state before the change).

- [ ] **Step 2: Confirm the current failure**

Run: `bun run typecheck`
Expected: FAIL, because `SettingsSidePanel` no longer accepts `onOpen`.

- [ ] **Step 3: Implement**

In `app.tsx`:
- Remove the `settingsView` state and its comment, and the `SettingGroupId`/`SettingId` type import.
- Remove `setSettingsView(null)` from `openChat`, `openPanel`, and `handlePopState`, with the comment above the popstate call.
- Remove the `SettingsView` import and its main-area branch.
- Restore `MainArea shown={activeChatId !== null || activePanel !== null}`.
- In the side column, replace the Settings branch `<SettingsSidePanel onOpen={...} />` with `<SettingsSidePanel context={{ preferences, onPreferences: setPreferences, away: realtime.away, onAwayToggle: toggleAway, push: push.status, pushBusy: push.busy, onPushToggle: togglePush }} />`.

- [ ] **Step 4: Run the checks**

Run: `grep -rn "settingsView\|SettingsView\|setSettingsView\|onOpen" src/ui/app.tsx src/ui/components/settings | grep -v "onOpen=\|SettingsGroup" ; bun run typecheck && bun test`
Expected: the grep prints nothing; typecheck clean; the full suite passes.

- [ ] **Step 5: Commit**

```bash
git add src/ui/app.tsx
git commit -m "feat(settings): remove the main-area settings view"
```

---

## Final checks (after Task 5)

- Run `bun run build` and restart the local Bridge with `./remote-agent.sh restart`, as before.
- Verify in a browser, when access is available: the side panel at 352px and at 260px; collapsing a group; searching keeps groups; the search header does not move while the list scrolls; the phone bottom bar at 360px.
