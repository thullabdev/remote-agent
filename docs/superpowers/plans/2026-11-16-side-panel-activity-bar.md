# Side panel activity bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the side column a tab strip (a far-left icon strip on desktop, a bottom bar on phones) where Chats is built in and each extension can register one tab; the terminal extension's list becomes its own tab.

**Architecture:** `extension-slots.ts` gains a side-tab registry that replaces the old sidebar-section slot. The host owns the selected tab (remembered in `localStorage`), renders `ActivityBar` beside the side panel, and renders either the chat list or the selected extension tab inside a shared `SidePanelFrame` (width, resize handle).

**Tech Stack:** React 19, Tailwind, lucide-react, bun test (`renderToStaticMarkup` for component tests).

**Spec:** `docs/superpowers/specs/2026-11-16-side-panel-activity-bar-design.md`

## Global Constraints

- Storage key for the selected tab: `remote-agent.side-tab.v1`.
- Chats is always the first tab, id `chats`, title `Chats`, icon `MessageSquareText`.
- Desktop activity strip width: `w-[52px]`. Phone bottom bar respects `env(safe-area-inset-bottom)`.
- Baseline before any change: `bun test` passes 1131 tests, 0 failing.

## Review Focus

1. A stored tab id that no longer exists (e.g. an extension was removed) → falls back to Chats, no crash. Covered by Task 2.
2. `localStorage` throws or holds garbage JSON → Chats selected. Covered by Task 2.
3. Registering the same tab id twice → one tab, the latest render. Covered by Task 1.
4. Terminal tab with no shells → shows an empty state, not a blank column. Covered by Task 6.
5. Terminal tab open while a chat is open → the chat stays in the main area. Covered by Task 5 (app wiring keeps `openChat` / `openPanel` unchanged).

---

### Task 1: Side-tab registry

**Files:**
- Modify: `src/ui/extension-slots.ts`
- Test: `test/ui/extension-slots.test.ts` (create)

**Interfaces:**
- Produces:
  - `type SideTabContext = { chats: Chat[]; activePanel: ActivePanel | null; openPanel: OpenPanel; notify: Notify }`
  - `type SideTabIcon = ComponentType<{ className?: string }>`
  - `type SideTab = { title: string; icon: SideTabIcon; render: (context: SideTabContext) => ReactNode }`
  - `registerSideTab(id: string, tab: SideTab): void` — same id replaces.
  - `sideTabs(): Array<SideTab & { id: string }>` — in registration order.
  - `sideTabRender(id: string, context: SideTabContext): ReactNode` — `null` if not registered.
- Removes: `SidebarContext`, `registerSidebarSection`, `sidebarSections`. `clearSlotsForTesting` clears the side-tab registry as well as the remaining slots.

- [ ] **Step 1: Write the failing test** in `test/ui/extension-slots.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { clearSlotsForTesting, registerSideTab, sideTabRender, sideTabs } from '../../src/ui/extension-slots.ts'

const ctx = { chats: [], activePanel: null, openPanel: () => {}, notify: () => {} }
const Icon = () => null

describe('side tabs', () => {
  beforeEach(() => clearSlotsForTesting())

  it('lists registered tabs in registration order with their ids', () => {
    registerSideTab('a', { title: 'A', icon: Icon, render: () => 'a' })
    registerSideTab('b', { title: 'B', icon: Icon, render: () => 'b' })
    expect(sideTabs().map(tab => [tab.id, tab.title])).toEqual([['a', 'A'], ['b', 'B']])
  })

  it('replaces a tab registered again under the same id', () => {
    registerSideTab('a', { title: 'A', icon: Icon, render: () => 'old' })
    registerSideTab('a', { title: 'A2', icon: Icon, render: () => 'new' })
    expect(sideTabs()).toHaveLength(1)
    expect(sideTabs()[0]?.title).toBe('A2')
  })

  it('renders a tab with the context and renders nothing for an unknown id', () => {
    registerSideTab('a', { title: 'A', icon: Icon, render: context => `chats:${context.chats.length}` })
    expect(sideTabRender('a', ctx)).toBe('chats:0')
    expect(sideTabRender('missing', ctx)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/ui/extension-slots.test.ts`
Expected: FAIL (`registerSideTab` is not exported).

- [ ] **Step 3: Implement** in `src/ui/extension-slots.ts`: replace the sidebar slot with a `Map<string, SideTab>` named `sideTabsById`; add the types and functions in the Interfaces block; `sideTabs()` maps entries to `{ id, ...tab }`; `sideTabRender` returns `tab.render(context)` or `null`. Keep `dashboard` and `chatActions` as they are. Import `ComponentType` from `react`. Update the header comment: side tabs are where extensions own a whole side view.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test test/ui/extension-slots.test.ts`
Expected: PASS, 3 tests.

Note: `app.tsx` and the terminal `index.tsx` still import the removed functions. Tasks 5 and 6 fix them; `bun run typecheck` will fail until then. That is expected at this point.

---

### Task 2: Remembered tab storage

**Files:**
- Create: `src/ui/components/side-panel/side-tab.ts`
- Test: `test/ui/side-tab.test.ts` (create)

**Interfaces:**
- Produces:
  - `export const CHATS_TAB = 'chats'`
  - `readSideTab(knownIds: readonly string[], storage?: Pick<Storage, 'getItem'>): string` — returns the stored id if it is in `knownIds`, else `CHATS_TAB`; any throw or bad JSON → `CHATS_TAB`.
  - `saveSideTab(id: string, storage?: Pick<Storage, 'setItem'>): void` — stores `JSON.stringify(id)`; the caller wraps it in try/catch.
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests** in `test/ui/side-tab.test.ts`: a fake storage object `{ getItem: () => value, setItem() {} }` (as in `preferences.test.ts`).
  - stored `'"terminal"'` with known `['terminal']` → `'terminal'`
  - stored `'"gone"'` with known `['terminal']` → `'chats'`
  - stored `null` → `'chats'`
  - stored `'{not json'` → `'chats'`
  - storage whose `getItem` throws → `'chats'`
  - `saveSideTab('terminal', storage)` calls `setItem('remote-agent.side-tab.v1', '"terminal"')`

- [ ] **Step 2: Run to verify failure**: `bun test test/ui/side-tab.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `side-tab.ts` with the key constant `remote-agent.side-tab.v1`. `readSideTab` uses `storage` default `localStorage` inside the function body, wrapped in try/catch.

- [ ] **Step 4: Run to verify pass**: `bun test test/ui/side-tab.test.ts` → PASS.

---

### Task 3: ActivityBar

**Files:**
- Create: `src/ui/components/side-panel/ActivityBar.tsx`
- Test: `test/ui/activity-bar.test.tsx` (create)

**Interfaces:**
- Produces:
  - `export type ActivityTab = { id: string; title: string; icon: ComponentType<{ className?: string }> }`
  - `export function ActivityBar({ tabs, selected, onSelect, className }: { tabs: ActivityTab[]; selected: string; onSelect(id: string): void; className?: string })`
- Consumes: `Button`-free; plain `<button>` elements with the `cn`-style class strings used elsewhere.

Rendering rules:
- Root: `<nav aria-label="Side panel tabs" className={\`... ${className}\`}>`. Desktop layout: `flex-col items-center gap-1 py-3 w-[52px] shrink-0 border-r border-border bg-background`. Phone layout (`max-md` default): `flex-row justify-around border-t border-border bg-background pb-[env(safe-area-inset-bottom)]`. Use `className` prop to pass `hidden md:flex` (desktop) or `flex md:hidden` (phone) from the caller, so the root itself only carries the shared colors and the caller decides which layout.
- Each tab: `<button type="button" aria-label={tab.title} title={tab.title} aria-pressed={tab.id === selected} onClick={() => onSelect(tab.id)}>` containing the icon (`className="size-5"`, `aria-hidden="true"`) and a `<span>` with the title shown only on phones: `text-[10px] md:sr-only`. Selected style: `text-foreground bg-muted`; unselected: `text-muted-foreground hover:text-foreground`.

- [ ] **Step 1: Write the failing test** `test/ui/activity-bar.test.tsx`:
  - renders one button per tab with `aria-label` equal to its title and `aria-pressed="true"` only on the selected id.
  - the root has `aria-label="Side panel tabs"` and contains the passed `className`.
  - uses a fake icon component (`const Icon = () => null`), so the markup does not depend on lucide.

- [ ] **Step 2: Run to verify failure**: `bun test test/ui/activity-bar.test.tsx` → FAIL.

- [ ] **Step 3: Implement** per the rules above. Clicks are not tested in markup; the `onSelect` wiring is covered by the app in Task 5 and by the manual check in Task 7.

- [ ] **Step 4: Run to verify pass**: `bun test test/ui/activity-bar.test.tsx` → PASS.

---

### Task 4: SidePanelFrame and SidePanel without sidebar sections

**Files:**
- Create: `src/ui/components/side-panel/SidePanelFrame.tsx`
- Modify: `src/ui/components/side-panel/SidePanel.tsx` (remove `sidebarSections` prop at line 47 and its use at line 148; wrap its `aside` in `SidePanelFrame`)

**Interfaces:**
- Produces:
  - `export function SidePanelFrame({ label, children }: { label: string; children: ReactNode })` — renders `<aside aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background md:relative md:flex-none md:w-[var(--chat-list-width)]" style={{ '--chat-list-width': \`${width}px\` }}>{children}<ResizeHandle edge={SIDE_PANEL_WIDTH.edge} label="Resize side panel" handle={handle} ariaValues={ariaValues} /></aside>`. It calls `useResizableWidth(SIDE_PANEL_WIDTH)` itself. `SIDE_PANEL_WIDTH` moves to `SidePanelFrame.tsx` and is re-exported from `SidePanel.tsx` so existing imports keep working.
- Consumes: `useResizableWidth`, `ResizeHandle`.
- SidePanel keeps all its props except `sidebarSections`. Its returned root becomes `<SidePanelFrame label="Sessions">…</SidePanelFrame>` and loses the `absolute`/`translate`/`md:` slide classes (those move to `SideColumn` in Task 5). Its `aria-label` stays `Sessions`.
- Chat-list resize label changes to `Resize side panel` (one label for every tab). Update `test/ui/chat-list.test.ts` or other tests only if they assert the old label (grep first: `grep -rn "Resize chat list" test`).

- [ ] **Step 1: Run the existing suite for the affected files to confirm the baseline**: `bun test test/ui/chat-state-surfaces.test.tsx test/ui/chat-list-search.test.tsx test/ui/chat-list.test.ts test/ui/use-resizable-width.test.ts` → PASS.

- [ ] **Step 2: Implement** `SidePanelFrame.tsx`, then edit `SidePanel.tsx` as described. Remove the `ReactNode` import only if it is unused afterwards.

- [ ] **Step 3: Run the same tests**: expect PASS. Any failure that comes from the removed `sidebarSections` prop means the test passes it: remove that prop from the test. Any failure from the label change means update the assertion to `Resize side panel`.

- [ ] **Step 4: Commit point** (no commit unless the user asks; leave the working tree changed).

---

### Task 5: Column and app wiring

**Files:**
- Create: `src/ui/components/side-panel/SideColumn.tsx`
- Modify: `src/ui/app.tsx` (imports at lines 6–20; the `<SidePanel …/>` block at lines 634–657; the `MainArea` line stays)

**Interfaces:**
- Produces:
  - `export function SideColumn({ shown, tabs, selected, onSelect, children }: { shown: boolean; tabs: ActivityTab[]; selected: string; onSelect(id: string): void; children: ReactNode })`
    - Root: `<div className={\`absolute inset-0 z-10 flex min-w-0 flex-col bg-background transition-[transform,visibility] duration-300 md:relative md:z-auto md:shrink-0 md:translate-x-0 ${shown ? 'translate-x-0' : '-translate-x-full max-md:invisible'}\`}>`. (Same slide rules the old `SidePanel` aside had.)
    - Inside: `<div className="flex min-h-0 min-w-0 flex-1">` containing `<ActivityBar tabs selected onSelect className="hidden md:flex" />` then `{children}`; then `<ActivityBar tabs selected onSelect className="flex md:hidden" />` as the last child (phone bottom bar).
    - Layout is decided by the caller, not by `ActivityBar`: the desktop bar gets `hidden md:flex flex-col w-[52px] border-r`, the phone bar gets `flex md:hidden flex-row border-t pb-[env(safe-area-inset-bottom)]`. `ActivityBar`'s own root only sets `items-center` and `bg-background`, plus whatever `className` adds. Task 3's root classes follow this split.
- `app.tsx` changes:
  - Add `const [sideTab, setSideTab] = useState(() => readSideTab(sideTabs().map(tab => tab.id)))` and an effect or handler that calls `saveSideTab` inside try/catch on change. `selectSideTab(id)` sets state and saves.
  - Build `const tabList: ActivityTab[] = [{ id: CHATS_TAB, title: 'Chats', icon: MessageSquareText }, ...sideTabs()]`.
  - Replace the `<SidePanel … sidebarSections={…} />` element with:
    ```tsx
    <SideColumn shown={activeChatId === null} tabs={tabList} selected={sideTab} onSelect={selectSideTab}>
      {sideTab === CHATS_TAB || sideTabs().every(tab => tab.id !== sideTab) ? <SidePanel …without sidebarSections… /> : <SidePanelFrame label={…}>{sideTabRender(sideTab, { chats, activePanel, openPanel, notify })}</SidePanelFrame>}
    </SideColumn>
    ```
    Use the `selectedSideTab` resolved value (the fallback) for the condition so the chat list shows when the stored id is stale. Label: the tab's title.
  - Keep `activeChatId === null` as the `shown` rule (unchanged behaviour).
  - Remove the `sidebarSections` import and the `activePanel` / `openPanel` / `notify` wiring stays as it is.
- Consumes: Tasks 1–4.

- [ ] **Step 1: Write a failing test** `test/ui/side-column.test.tsx`: `renderToStaticMarkup(<SideColumn shown tabs={[{id:'chats',title:'Chats',icon:Icon}]} selected="chats" onSelect={() => {}}><span>body</span></SideColumn>)` contains `body`, contains two `aria-label="Side panel tabs"` navs (desktop and phone), and contains `aria-pressed="true"` once.

- [ ] **Step 2: Run to verify failure**: `bun test test/ui/side-column.test.tsx` → FAIL.

- [ ] **Step 3: Implement** `SideColumn.tsx` and the `app.tsx` changes above.

- [ ] **Step 4: Run to verify pass**: `bun test test/ui/side-column.test.tsx test/ui/app-terminal-navigation.test.tsx` → PASS. Then `bun run typecheck` → the only remaining errors should be in `extensions/terminal/frontend/index.tsx` and `surfaces.tsx` (fixed in Task 6).

---

### Task 6: Terminal side tab

**Files:**
- Modify: `extensions/terminal/frontend/surfaces.tsx` (replace `TerminalsSidebarSection`, lines 27–62, with `TerminalsSideTab`)
- Modify: `extensions/terminal/frontend/index.tsx` (replace the `registerSidebarSection` line)
- Modify: `extensions/terminal/frontend/surfaces.test.tsx` (rename its `sidebar` helper and `describe` to the side tab; update expectations below)

**Interfaces:**
- Produces: `export function TerminalsSideTab({ chats, activePanel, openPanel, notify }: SideTabContext): ReactNode`
  - Starts `startSessionEvents()` and `refreshSessions()` in an effect, as the section does today.
  - Renders a header row: a `Heading` titled `Terminals`, and a `Button` `aria-label="New terminal"` that calls `startTerminal({ cwd: <first group's cwd> }, openPanel, notify)` when there is at least one group; disabled when there are none.
  - Body: a scroll container `min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:pb-24` holding the existing folder groups and rows (unchanged markup).
  - When there are no terminals: an empty state in the body with the text `No terminals open. Use the terminal button in a session's header to open one.`
- `index.tsx`:
  ```ts
  registerSideTab('terminal', { title: 'Terminals', icon: Terminal, render: context => <TerminalsSideTab {...context} /> })
  ```
  with `Terminal` imported from `lucide-react`. Remove `registerSidebarSection` from the import.
- The dashboard card and chat action are unchanged.

- [ ] **Step 1: Update the tests first** in `surfaces.test.tsx`:
  - `renders nothing when no shell is open` → now expects the empty-state text `No terminals open` to be present.
  - Other expectations use the new export name `TerminalsSideTab` (the markup is unchanged, so the rest pass).
  - Add: `it('offers a new terminal button only when there is a folder to start one in')`: with no shells, markup contains `aria-label="New terminal"` and `disabled`; with one shell, it does not contain `disabled` on that button.
- [ ] **Step 2: Run to verify failure**: `bun test extensions/terminal/frontend/surfaces.test.tsx` → FAIL.
- [ ] **Step 3: Implement** the component and `index.tsx` registration.
- [ ] **Step 4: Run to verify pass**: `bun test extensions/terminal/frontend/` → PASS.

---

### Task 7: Full verification

- [ ] **Step 1: Full test suite**: `bun test` → expect 0 failing; the count will be 1131 plus the new tests.
- [ ] **Step 2: Typecheck**: `bun run typecheck` → no errors.
- [ ] **Step 3: Build**: `bun run build` → succeeds.
- [ ] **Step 4: Visual check** (desktop and phone width): `bun run dev`, open the app, confirm: the strip shows Chats and Terminals; selecting Terminals swaps the list while an open chat stays in the main area; on a phone width the bottom bar shows only when no chat is open; a stored unknown tab id falls back to Chats. Report what you could and could not check in a browser.
