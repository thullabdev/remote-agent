# Settings in the activity bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move settings from the gear button and dialog into a Settings tab in the activity bar, with a grouped, searchable side panel and a main-area settings view.

**Architecture:** Settings are host-owned data (a registry of groups and settings) rendered by three components: a side tab (search and group list), a main-area view (the selected group's settings), and the existing control widgets moved out of the dialog. App state picks one main-area view at a time (chat, extension panel, or settings). The side tab is registered by the host, not through `registerSideTab`.

**Tech Stack:** React, TypeScript, Tailwind classes, lucide-react icons, bun test with `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-11-19-settings-activity-bar-design.md`

## Global Constraints

- Every setting moves; none is added or removed. Titles and descriptions are copied from `src/ui/components/settings-dialog.tsx`.
- Group titles: `Appearance`, `Chat`, `Notifications & presence`, in that order.
- The Settings tab id is `settings`, its title is `Settings`, its icon is lucide `Settings`, and it is always last in the tab list.
- Preferences keep their storage key `remote-agent.preferences.v1` and their `localStorage` try/catch behaviour.
- The gear button in the chat header and `settings-dialog.tsx` are removed. No reference to `SettingsDialog`, `settingsOpen`, or `onSettings` remains.
- Commit at the end of each task on `feat/settings-activity-bar`.

## Review Focus

1. A query that matches nothing shows a visible empty message, not a blank panel. Test in Task 4.
2. A query containing regex characters such as `(` or `*` is matched as plain text and does not throw. Test in Task 1.
3. Opening a chat or an extension panel while settings are shown returns the main area to that chat or panel. Test in Task 6.
4. A browser without Web Push still shows the Notifications group, with Push disabled and its explanation. Test in Task 3.
5. A failed preference save (storage refuses) does not blank the settings view; the existing notice still appears. Test in Task 6.

---

### Task 1: Settings registry and search

**Files:**
- Create: `src/ui/settings/settings-registry.ts`
- Create: `src/ui/settings/settings-search.ts`
- Test: `test/ui/settings-search.test.ts`
- Stage: `docs/superpowers/specs/2026-11-19-settings-activity-bar-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type SettingGroupId = 'appearance' | 'chat' | 'notifications'`
  - `type SettingId = 'theme' | 'colorTheme' | 'accent' | 'glow' | 'density' | 'fontSize' | 'enter' | 'codeWrap' | 'awayMode' | 'pushNotifications'`
  - `type SettingGroup = { id: SettingGroupId; title: string }`
  - `type SettingDefinition = { id: SettingId; group: SettingGroupId; title: string; description: string; keywords: readonly string[] }`
  - `const SETTING_GROUPS: readonly SettingGroup[]`: the three groups in display order.
  - `const SETTINGS: readonly SettingDefinition[]`: all ten settings in display order (Appearance: theme, colorTheme, accent, glow, density, fontSize; Chat: enter, codeWrap; Notifications: awayMode, pushNotifications).
  - `function settingsIn(group: SettingGroupId): SettingDefinition[]`
  - `function searchSettings(query: string): SettingDefinition[]`: returns `[]` for a blank query.

- [ ] **Step 1: Write the failing test**

```ts
// test/ui/settings-search.test.ts
import { describe, expect, it } from 'bun:test'
import { SETTINGS, SETTING_GROUPS, settingsIn } from '../../src/ui/settings/settings-registry.ts'
import { searchSettings } from '../../src/ui/settings/settings-search.ts'

describe('settings registry', () => {
  it('gives every setting a known group and a unique id', () => {
    const groups = new Set(SETTING_GROUPS.map(group => group.id))
    const ids = SETTINGS.map(setting => setting.id)
    expect(SETTINGS.every(setting => groups.has(setting.group))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lists the groups in order with their titles', () => {
    expect(SETTING_GROUPS.map(group => group.title)).toEqual(['Appearance', 'Chat', 'Notifications & presence'])
    expect(settingsIn('chat').map(setting => setting.id)).toEqual(['enter', 'codeWrap'])
  })
})

describe('searchSettings', () => {
  it('returns nothing for a blank query', () => {
    expect(searchSettings('')).toEqual([])
    expect(searchSettings('   ')).toEqual([])
  })

  it('matches titles, descriptions and keywords, ignoring case', () => {
    expect(searchSettings('ACCENT').map(setting => setting.id)).toContain('accent')
    expect(searchSettings('system').map(setting => setting.id)).toContain('theme')
    expect(searchSettings('web push').map(setting => setting.id)).toEqual(['pushNotifications'])
  })

  it('requires every word of the query to match', () => {
    expect(searchSettings('font size').map(setting => setting.id)).toEqual(['fontSize'])
    expect(searchSettings('font zebra')).toEqual([])
  })

  it('treats regex characters as plain text', () => {
    expect(() => searchSettings('(')).not.toThrow()
    expect(searchSettings('*')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-search.test.ts`
Expected: FAIL with "Cannot find module" for `settings-registry.ts`.

- [ ] **Step 3: Implement the registry and search**

`settings-registry.ts` holds the types and the three constants listed under Interfaces, with the exact titles and descriptions from the dialog. `settingsIn` filters `SETTINGS` by group. Keywords (exact): theme `['dark', 'light', 'mode', 'system']`; colorTheme `['palette', 'colors']`; accent `['color', 'highlight']`; glow `['light', 'highlight']`; density `['compact', 'comfortable', 'spacing']`; fontSize `['text', 'size', 'font']`; enter `['send', 'newline', 'return']`; codeWrap `['wrap', 'scroll', 'code']`; awayMode `['notify', 'presence', 'away']`; pushNotifications `['notify', 'web push', 'alerts']`. Descriptions: theme `Light, dark, or follow the system.`; awayMode `When on, reports notify you if no device is focused on the chat.`; glow `Accent light in chat.`; enter `Sends the message, or adds a new line.`; codeWrap `Scroll sideways inside a code block, or wrap onto the next line.`; density, fontSize, colorTheme, accent: a one-line description of what the control changes; pushNotifications `Prompts always notify you. Reports notify you when Away mode is on and no device is focused on the chat.`

`searchSettings`: split the trimmed, lowercased query on whitespace; return `[]` if there are no words. A setting matches when every word is a substring (`String.prototype.includes`, no RegExp) of `[title, description, ...keywords].join(' ').toLowerCase()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ui/settings-search.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings/settings-registry.ts src/ui/settings/settings-search.ts test/ui/settings-search.test.ts docs/superpowers/specs/2026-11-19-settings-activity-bar-design.md
git commit -m "feat(settings): add settings registry and search"
```

---

### Task 2: Move the control widgets out of the dialog

**Files:**
- Create: `src/ui/components/settings/settings-controls.tsx`
- Modify: `src/ui/components/settings-dialog.tsx` (import the moved widgets; delete their local copies)
- Test: `test/ui/settings-controls.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (exported from `settings-controls.tsx`, with the same markup and classes as today):
  - `SettingLabel({ children: ReactNode })`
  - `SettingSegments<T extends string>({ label: string; value: T; options: readonly (readonly [T, string])[]; onChange(value: T): void })`: renders the label and the segmented control. Its `label` is also used as the accessible group name (`role="group"` with `aria-label={label}`).
  - `SettingSwitch({ label: string; checked: boolean; onChange(): void })`: the `role="switch"` button, `aria-label={label}`.
  - `AccentSwatches({ value: AccentPreference; onChange(value: AccentPreference): void })`: the seven accent buttons with `aria-label="${value} accent"`.
  - `ColorThemeGrid({ value: string; onChange(value: string): void })`: the color theme buttons from `COLOR_THEMES`.

- [ ] **Step 1: Write the failing test**

```tsx
// test/ui/settings-controls.test.tsx
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingSegments, SettingSwitch } from '../../src/ui/components/settings/settings-controls.tsx'

describe('settings controls', () => {
  it('marks only the chosen segment as pressed and names the group', () => {
    const html = renderToStaticMarkup(
      <SettingSegments label="Density" value="compact" onChange={() => {}} options={[['compact', 'Compact'], ['comfortable', 'Comfortable']]} />,
    )
    expect(html).toContain('aria-label="Density"')
    expect(html).toMatch(/aria-pressed="true"[^>]*>Compact</)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('renders a switch with its checked state', () => {
    const html = renderToStaticMarkup(<SettingSwitch label="Away mode" checked onChange={() => {}} />)
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('aria-label="Away mode"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-controls.test.tsx`
Expected: FAIL with "Cannot find module" for `settings-controls.tsx`.

- [ ] **Step 3: Implement**

Move `SettingLabel`, `SettingSegments`, the accent array and swatch buttons, and the color theme grid from `settings-dialog.tsx` into `settings-controls.tsx`, exporting the components listed above. Keep the markup and classes unchanged, except: `SettingSegments` gets `role="group" aria-label={label}` on its wrapper, and the Away-mode and push switch markup is replaced by `SettingSwitch`. The `accents` constant moves with `AccentSwatches`. In `settings-dialog.tsx`, import these components and delete the local copies; the dialog must still render and behave the same, so existing behaviour is unchanged at this step.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-controls.test.tsx && bun run typecheck`
Expected: PASS for the test; typecheck reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/settings-controls.tsx src/ui/components/settings-dialog.tsx test/ui/settings-controls.test.tsx
git commit -m "refactor(settings): move setting controls into their own module"
```

---

### Task 3: Settings main-area view

**Files:**
- Create: `src/ui/components/settings/SettingsView.tsx`
- Test: `test/ui/settings-view.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`SettingGroupId`, `SettingId`, `settingsIn`, `SETTING_GROUPS`); Task 2 (`SettingLabel`, `SettingSegments`, `SettingSwitch`, `AccentSwatches`, `ColorThemeGrid`); `Preferences` and `DEFAULT_PREFERENCES` from `src/ui/preferences.ts`; `PushStatus` from `src/ui/use-push-subscription.ts`.
- Produces:
  ```ts
  export type SettingsViewProps = {
    group: SettingGroupId
    /** Scrolled to and briefly highlighted, when a search result opened this group. */
    focus?: SettingId
    preferences: Preferences
    onPreferences(preferences: Preferences): void
    away: boolean
    onAwayToggle(): void
    push: PushStatus
    pushBusy: boolean
    onPushToggle(): void
    /** Phone only: returns to the group list. Omitted on desktop. */
    onBack?(): void
  }
  export function SettingsView(props: SettingsViewProps): JSX.Element
  ```
  Each setting is wrapped in `<section id={\`setting-${id}\`} data-setting={id}>`. The group title is the heading (`<h2>`), and a back button (`aria-label="Back to settings"`) renders only when `onBack` is given.

- [ ] **Step 1: Write the failing test**

```tsx
// test/ui/settings-view.test.tsx
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsView, type SettingsViewProps } from '../../src/ui/components/settings/SettingsView.tsx'
import { DEFAULT_PREFERENCES } from '../../src/ui/preferences.ts'

const base: SettingsViewProps = {
  group: 'chat',
  preferences: DEFAULT_PREFERENCES,
  onPreferences: () => {},
  away: false,
  onAwayToggle: () => {},
  push: { supported: false, subscribed: false, iosHomeScreenRequired: false },
  pushBusy: false,
  onPushToggle: () => {},
}

describe('SettingsView', () => {
  it('renders only the settings of its group', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} />)
    expect(html).toContain('data-setting="enter"')
    expect(html).toContain('data-setting="codeWrap"')
    expect(html).not.toContain('data-setting="theme"')
    expect(html).toContain('<h2')
  })

  it('shows the Web Push explanation when the browser lacks it', () => {
    const html = renderToStaticMarkup(<SettingsView {...base} group="notifications" />)
    expect(html).toContain('does not support Web Push')
    expect(html).toMatch(/aria-label="Push notifications"|Push notifications/)
  })

  it('shows a back button only when given onBack', () => {
    expect(renderToStaticMarkup(<SettingsView {...base} />)).not.toContain('aria-label="Back to settings"')
    expect(renderToStaticMarkup(<SettingsView {...base} onBack={() => {}} />)).toContain('aria-label="Back to settings"')
  })
})
```

Check the `PushStatus` field names in `src/ui/use-push-subscription.ts` before running; adjust the `push` literal if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-view.test.tsx`
Expected: FAIL with "Cannot find module" for `SettingsView.tsx`.

- [ ] **Step 3: Implement**

For each setting in `settingsIn(group)`, render a `<section id data-setting>` with its title (`<SettingLabel>` or a row title, matching the dialog's current look), its description, and the control from Task 2. Controls, using the dialog's existing handlers:
- theme: `SettingSegments` over `['light','Light'], ['dark','Dark'], ['system','System']`, writing `preferences.theme`.
- colorTheme: `ColorThemeGrid`, writing `palette`.
- accent: `AccentSwatches`, writing `accent`.
- glow: `SettingSegments` over off/soft/strong, writing `glow`.
- density: `SettingSegments` over compact/comfortable, writing `density`.
- fontSize: `SettingSegments` over small/medium/large (label `Chat font size`), writing `font`; render the existing preview line (`Preview: The more I learn, the more I realize how much I still have to learn.`) under it with the same font-size mapping.
- enter: `SettingSegments` over `['send','Sends'], ['newline','New line']`, writing `enter`.
- codeWrap: `SettingSegments` over `['scroll','Scroll'], ['wrap','Wrap']`, writing `codeWrap`.
- awayMode: `SettingSwitch` with `away`, `onAwayToggle`.
- pushNotifications: the existing enable/on `Button`, the unsupported note, and the iOS Home Screen notice, copied from the dialog.

Each setting's writes use `onPreferences({ ...preferences, <key>: value })`, as the dialog does. When `focus` is set, a `useEffect` calls `scrollIntoView({ block: 'center' })` on `#setting-${focus}` and adds a `ring-2 ring-primary` class for about 1.5 s. Use `useEffect` with `[focus, group]` as its dependencies.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-view.test.tsx && bun run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/SettingsView.tsx test/ui/settings-view.test.tsx
git commit -m "feat(settings): add the settings group view"
```

---

### Task 4: Settings side panel (search and group list)

**Files:**
- Create: `src/ui/components/settings/SettingsSidePanel.tsx`
- Test: `test/ui/settings-side-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`SETTING_GROUPS`, `settingsIn`, `searchSettings`, types); `SidePanelFrame` from `src/ui/components/side-panel/SidePanelFrame.tsx`; `Input` from `src/ui/components/ui/input.tsx`.
- Produces:
  ```ts
  export type SettingsSidePanelProps = {
    /** Opens a group in the main area; `focus` names the setting a search result picked. */
    onOpen(group: SettingGroupId, focus?: SettingId): void
  }
  export function SettingsSidePanel(props: SettingsSidePanelProps): JSX.Element
  ```
  The query is local state; it is not kept when the tab is left.

- [ ] **Step 1: Write the failing test**

```tsx
// test/ui/settings-side-panel.test.tsx
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSidePanel } from '../../src/ui/components/settings/SettingsSidePanel.tsx'

describe('SettingsSidePanel', () => {
  it('lists the three groups with a search field', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel onOpen={() => {}} />)
    expect(html).toContain('aria-label="Search settings"')
    expect(html).toContain('Appearance')
    expect(html).toContain('Chat')
    expect(html).toContain('Notifications &amp; presence')
  })

  it('shows the matching settings in place of the groups when a query is given', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel onOpen={() => {}} initialQuery="accent" />)
    expect(html).toContain('Accent')
    expect(html).not.toContain('Notifications &amp; presence')
  })

  it('says so when nothing matches', () => {
    const html = renderToStaticMarkup(<SettingsSidePanel onOpen={() => {}} initialQuery="zebra" />)
    expect(html).toContain('No settings match')
    expect(html).toContain('zebra')
  })
})
```

Add an optional `initialQuery?: string` prop (default `''`) for testing; it is used only to seed the local query state.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/settings-side-panel.test.tsx`
Expected: FAIL with "Cannot find module" for `SettingsSidePanel.tsx`.

- [ ] **Step 3: Implement**

Render `SidePanelFrame label="Settings"`, containing a header with the `Input` (`aria-label="Search settings"`, `placeholder="Search settings"`, styled like `SearchBar`, with a clear button `aria-label="Clear search"` while the query is non-empty). Below it:
- Blank query: one button per group in `SETTING_GROUPS`, showing the group title and its setting count, `onClick={() => onOpen(group.id)}`.
- Non-blank query: each result from `searchSettings(query)` as a button showing the title, the group title, and the description. `onClick={() => onOpen(setting.group, setting.id)}`.
- No results: `No settings match "<query>".` (the query is rendered as text, escaped by React).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/settings-side-panel.test.tsx && bun run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/SettingsSidePanel.tsx test/ui/settings-side-panel.test.tsx
git commit -m "feat(settings): add the searchable settings side panel"
```

---

### Task 5: Register the Settings tab id

**Files:**
- Modify: `src/ui/components/side-panel/side-tab.ts`
- Modify: `test/ui/side-tab.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const SETTINGS_TAB = 'settings'` in `side-tab.ts`.
  - `readSideTab(knownIds, storage)` now also accepts `SETTINGS_TAB` as a valid remembered tab, even though it is not in `knownIds`, since the host registers it.

- [ ] **Step 1: Write the failing test**

Add to `test/ui/side-tab.test.ts`:

```ts
import { SETTINGS_TAB } from '../../src/ui/components/side-panel/side-tab.ts'

it('returns the remembered Settings tab without it being registered', () => {
  expect(readSideTab(['terminal'], storageWith(`"${SETTINGS_TAB}"`))).toBe(SETTINGS_TAB)
})
```

(Merge the import into the existing import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/side-tab.test.ts`
Expected: FAIL: `SETTINGS_TAB` is not exported, or the read returns `chats`.

- [ ] **Step 3: Implement**

Add `export const SETTINGS_TAB = 'settings'` next to `CHATS_TAB`, with a doc comment that the host owns it and places it last. In `readSideTab`, accept `stored === CHATS_TAB || stored === SETTINGS_TAB || knownIds.includes(stored)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/side-tab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/side-panel/side-tab.ts test/ui/side-tab.test.ts
git commit -m "feat(settings): add the Settings tab id"
```

---

### Task 6: Wire the tab into the app and remove the gear dialog

**Files:**
- Modify: `src/ui/app.tsx`
- Modify: `src/ui/components/side-panel/SidePanel.tsx` (remove the `onSettings` prop and the gear `Button`, and its `Settings` import)
- Modify: `test/ui/chat-list-search.test.tsx`, `test/ui/chat-state-surfaces.test.tsx` (remove `onSettings: noop` / `onSettings: () => {}` from props objects)
- Delete: `src/ui/components/settings-dialog.tsx`

**Interfaces:**
- Consumes: Task 3 (`SettingsView`), Task 4 (`SettingsSidePanel`), Task 5 (`SETTINGS_TAB`).
- Produces (in `app.tsx`):
  - `const [settingsView, setSettingsView] = useState<{ group: SettingGroupId; focus?: SettingId } | null>(null)`
  - `sideTabList` gains `{ id: SETTINGS_TAB, title: 'Settings', icon: Settings }` as its last entry.
  - `openChat` and `openPanel` set `settingsView` to `null`.
  - The side column renders `<SettingsSidePanel onOpen={(group, focus) => setSettingsView({ group, focus })} />` when `sideTab === SETTINGS_TAB`.
  - The main area is shown when `activeChatId !== null || activePanel !== null || settingsView !== null`. When `settingsView !== null`, it renders `<SettingsView group focus preferences onPreferences={setPreferences} away={realtime.away} onAwayToggle={toggleAway} push={push.status} pushBusy={push.busy} onPushToggle={togglePush} onBack={() => setSettingsView(null)} />` in place of the chat or panel.

- [ ] **Step 1: Write the failing test**

Update the two test files first so they no longer pass `onSettings`, and add an assertion to `test/ui/chat-list-search.test.tsx`:

```tsx
it('has no gear button in the chat header', () => {
  expect(render('')).not.toContain('aria-label="Settings"')
})
```

Run: `bun test test/ui/chat-list-search.test.tsx`
Expected: FAIL, because the gear button still renders.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/chat-list-search.test.tsx`
Expected: FAIL on the new assertion.

- [ ] **Step 3: Implement**

In `SidePanel.tsx`, remove the `onSettings` prop, its destructuring, and the gear `Button` with `Settings` in the import. In `app.tsx`:
1. Import `Settings` from lucide, `SETTINGS_TAB` from `side-tab.ts`, `SettingsSidePanel`, `SettingsView`, and the `SettingGroupId`/`SettingId` types.
2. Add the `settingsView` state. Clear it inside `openChat` and `openPanel`.
3. Add the Settings entry to `sideTabList` after `sideTabs()`.
4. In the `SideColumn` children, add the `sideTab === SETTINGS_TAB` branch before the extension branch, rendering `SettingsSidePanel` (it supplies its own `SidePanelFrame`, as `SidePanel` does).
5. Extend the main-area condition and render `SettingsView` when `settingsView !== null`, before the chat and panel branches.
6. Remove the `SettingsDialog` render, the `settingsOpen` state, and the `onSettings` prop passed to `SidePanel`.
7. Delete `src/ui/components/settings-dialog.tsx`.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: all tests PASS; typecheck has no errors.

Then run `grep -rn "SettingsDialog\|settingsOpen\|onSettings\|settings-dialog" src test` and expect no output.

- [ ] **Step 5: Commit**

```bash
git add -A src/ui test/ui
git commit -m "feat(settings): move settings into the activity bar"
```

---

### Task 7: Verify in the running app

**Files:** none changed unless a check finds a defect (then fix and re-run Task 6 tests).

**Interfaces:** none.

- [ ] **Step 1: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 2: Check the desktop layout and search**

Use the `run` skill to start the app. At desktop width: the Settings gear is the last activity-bar icon; selecting it shows the three groups; typing `accent` shows the Accent result; picking it opens Appearance in the main area and highlights Accent; changing Theme still updates the page; opening a chat returns the main area to the chat.

- [ ] **Step 3: Check the phone layout at 360px**

At 360px wide: the bottom bar shows every tab with its label fully visible (no truncation or overlap); picking a group opens the main area with a back button that returns to the group list.

- [ ] **Step 4: Report**

Report the test and typecheck output, and what was checked in the browser. If a check was not run, say so.
