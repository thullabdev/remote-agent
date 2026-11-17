# Git extension + chat-info accordion slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat-scoped Git extension (Git side tab, "File changes" chat-info accordion, diff main panel) and the generic chat-info accordion slot it needs.

**Architecture:** The host gains two generic slots (`registerChatInfoSection`, plus a shared `Accordion` component) and nothing about git. All git code lives in `extensions/git/`: a backend that runs fixed `git` argv via `Bun.spawn` under `/api/extensions/remote-agent.git/`, and a frontend that registers a side tab, a chat-info section and a main-area panel. Open diff tabs persist per chat in `localStorage`.

**Tech Stack:** Bun + TypeScript (backend, `bun test`), React 19 + Tailwind + lucide-react (frontend), `shiki` (new dependency, lazy-loaded for diffs), zod (route validation).

**Spec:** [`docs/superpowers/specs/2026-11-17-git-extension-design.md`](../specs/2026-11-17-git-extension-design.md) (approved 2026-11-17)

## Global Constraints

- Branch: `feat/git-extension`. Commit after each task. Commit messages are plain, with no `Co-Authored-By` trailer (per project CLAUDE.md).
- TypeScript: no short-if early returns. Always use braces: `if (x) {\n  return\n}`.
- The host (`src/`) contains no git code. Only the slot and the accordion component are added there.
- Git is always run as `Bun.spawn(['git', '-C', cwd, ...args])`. No shell strings. Commit messages and paths are passed as argv, never interpolated.
- `shiki` is loaded with a dynamic `import('shiki')` only when a diff opens.
- `localStorage` access is always wrapped in try/catch.
- Test runner: `bun test`. Typecheck: `bun run typecheck`. Build: `bun run build`.

### Amendment to spec Decision 5 (routes take `cwd`, not `chatId`)

Extension backends cannot read chats, so the route cannot turn `chatId` into `launchCwd` on its own. The client sends the chat's `launchCwd` as `cwd` (the same pattern the terminal routes use). The server then:

1. requires `cwd` to be an existing absolute directory,
2. resolves the repository with `git -C <cwd> rev-parse --show-toplevel`, returning `repo: false` when that fails,
3. accepts `paths` only if each one appears in the current `git status` output of that repository (so a client cannot make git read arbitrary files).

Routes added to the spec's list, covering the approved stage/unstage controls (Decision 7):
- `POST /stage` `{ cwd, paths: string[] }` → `git add -- <paths>`
- `POST /unstage` `{ cwd, paths: string[] }` → `git restore --staged -- <paths>` (or `git rm --cached -- <paths>` when the repository has no commits yet)

## Review Focus

1. **Repository with no commits (unborn HEAD).** Log returns `[]`, numstat is computed against the empty tree, and unstage still works. Test: Task 4 (`git.test.ts`, "unborn HEAD") and Task 5 (`routes.test.ts`, "unstage in a repo without commits").
2. **Unusual file names.** Spaces, quotes, non-ASCII, and renames must parse correctly. Test: Task 4 ("paths with spaces and unicode survive `-z` parsing", "rename entries carry the new path").
3. **Launch folder that is not a repository, or is a subfolder of one.** Not a repository → `repo: false`, and the UI shows the empty state. A subfolder → the repository is found from above, and paths show relative to `launchCwd` with `../` for files outside it. Test: Task 5 ("launch folder that is a subfolder reports repo true") and Task 5 ("folder that is not a repo reports repo false").
4. **Binary files.** Numstat reports `-`; counts must show as binary, never `NaN` or `0 / 0`. Test: Task 4 ("binary numstat is reported as binary").
5. **Commit and path input from the client.** Empty or whitespace-only message is refused; nothing staged is refused; a message starting with `-` is passed safely; a path that is not in status is refused. Test: Task 5 ("commit refuses empty message", "commit refuses nothing staged", "stage refuses a path that is not in status").

---

## File Structure

**Create**
- `src/ui/components/ui/accordion.tsx`: shared accordion (title row, chevron, body, persisted open state).
- `src/ui/components/ui/accordion-state.ts`: `localStorage` read/write for open state (testable with injected storage).
- `extensions/git/plugin.json`: manifest.
- `extensions/git/backend/parse.ts`: pure parsers (porcelain v2 status, numstat, log, diff hunks, commit files).
- `extensions/git/backend/git.ts`: `runGit(cwd, args)` and repository operations built on it.
- `extensions/git/backend/routes.ts`: route handlers (`repo`, `status`, `log`, `commit-files`, `diff`, `stage`, `unstage`, `commit`) with validation.
- `extensions/git/backend/index.ts`: `onActivate` registering the routes.
- `extensions/git/frontend/client.ts`: fetch wrappers for the routes.
- `extensions/git/frontend/tree.ts`: builds the folder tree from paths and sums counts.
- `extensions/git/frontend/open-files.ts`: per-chat open diff tabs in `localStorage`.
- `extensions/git/frontend/highlight.ts`: lazy `shiki` loader and `highlightLines(code, lang)`.
- `extensions/git/frontend/StatusTree.tsx`: tree view with stage/unstage buttons.
- `extensions/git/frontend/GitSideTab.tsx`: the Git tab (header, sections, commit form).
- `extensions/git/frontend/CommitLog.tsx`: the log section and commit file lists.
- `extensions/git/frontend/CommitDialog.tsx`: confirmation dialog before commit.
- `extensions/git/frontend/DiffPanel.tsx`: main-area diff panel.
- `extensions/git/frontend/ChangedFilesSection.tsx`: the "File changes" chat-info accordion body.
- `extensions/git/frontend/index.tsx`: registrations.
- Tests next to each file: `*.test.ts(x)`.

**Modify**
- `src/ui/extension-slots.ts`: add `registerChatInfoSection`, `chatInfoSections`, `ChatInfoSectionContext`; clear them in `clearSlotsForTesting`.
- `src/ui/components/details/SessionDetails.tsx`: render registered chat-info sections, each in an `Accordion`.
- `src/ui/components/details/BookmarksSection.tsx`, `ForksSection.tsx`, `TechnicalSection.tsx`: wrap their content in `Accordion` (same content, new chrome).
- `src/ui/extensions.ts`: import `../../extensions/git/frontend/index.tsx`.
- `package.json`: add `shiki` dependency.

---

### Task 1: Chat-info accordion slot

**Files:**
- Modify: `src/ui/extension-slots.ts`
- Test: `src/ui/extension-slots.test.ts` (create)

**Interfaces:**
- Consumes: `Chat` from `src/channel/web/protocol.ts`, `OpenPanel`, `Notify` (already in `extension-slots.ts`).
- Produces:
  ```ts
  export type ChatInfoSectionContext = { chat: Chat; openPanel: OpenPanel; notify: Notify; density: 'compact' | 'comfortable' }
  export function registerChatInfoSection(id: string, title: string, render: (context: ChatInfoSectionContext) => ReactNode): void
  export function chatInfoSections(): Array<{ id: string; title: string; render: (context: ChatInfoSectionContext) => ReactNode }>
  ```
  `clearSlotsForTesting()` also clears these.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, expect, test } from 'bun:test'
import { chatInfoSections, clearSlotsForTesting, registerChatInfoSection } from './extension-slots.ts'

beforeEach(() => clearSlotsForTesting())

test('each registration is its own section, in registration order', () => {
  registerChatInfoSection('a', 'File changes', () => null)
  registerChatInfoSection('b', 'Notes', () => null)
  expect(chatInfoSections().map(s => [s.id, s.title])).toEqual([['a', 'File changes'], ['b', 'Notes']])
})

test('registering the same id again replaces that section and keeps its place', () => {
  registerChatInfoSection('a', 'First', () => null)
  registerChatInfoSection('b', 'Second', () => null)
  registerChatInfoSection('a', 'First again', () => null)
  expect(chatInfoSections().map(s => [s.id, s.title])).toEqual([['a', 'First again'], ['b', 'Second']])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/ui/extension-slots.test.ts`
Expected: FAIL, `registerChatInfoSection` is not exported.

- [ ] **Step 3: Implement in `src/ui/extension-slots.ts`**

Add a `Map<string, { title: string; render: ... }>` named `chatInfoById` (a `Map` keeps insertion order, and `set` on an existing key keeps its position, which gives the replace-in-place behaviour the test checks). Export the two functions above. Add `chatInfoById.clear()` to `clearSlotsForTesting`. Use the `ReactNode` import already in the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/ui/extension-slots.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/extension-slots.ts src/ui/extension-slots.test.ts
git commit -m "feat(ui): add a chat-info accordion slot"
```

---

### Task 2: Shared accordion component

**Files:**
- Create: `src/ui/components/ui/accordion-state.ts`, `src/ui/components/ui/accordion.tsx`
- Test: `src/ui/components/ui/accordion-state.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // accordion-state.ts
  export type OpenStateStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void }
  export function readOpen(storage: OpenStateStorage | null, id: string, fallback: boolean): boolean
  export function writeOpen(storage: OpenStateStorage | null, id: string, open: boolean): void
  // accordion.tsx
  export function Accordion(props: { id: string; title: ReactNode; defaultOpen?: boolean; children: ReactNode }): JSX.Element
  ```
  Storage key: `remote-agent.accordion.v1`, one JSON object `{ [id]: boolean }`. `Accordion` uses `window.localStorage` (or `null` if unavailable).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test'
import { readOpen, writeOpen, type OpenStateStorage } from './accordion-state.ts'

function memory(): OpenStateStorage {
  const map = new Map<string, string>()
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
}

test('falls back to the default when nothing is stored', () => {
  expect(readOpen(memory(), 'files', true)).toBe(true)
})

test('remembers the open state per id', () => {
  const storage = memory()
  writeOpen(storage, 'files', false)
  writeOpen(storage, 'log', true)
  expect(readOpen(storage, 'files', true)).toBe(false)
  expect(readOpen(storage, 'log', false)).toBe(true)
})

test('a throwing or corrupt store falls back to the default', () => {
  const throwing: OpenStateStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  expect(readOpen(throwing, 'files', true)).toBe(true)
  writeOpen(throwing, 'files', false)
  expect(readOpen({ getItem: () => '{not json', setItem: () => {} }, 'files', true)).toBe(true)
})

test('null storage (no localStorage) falls back to the default and never throws', () => {
  expect(readOpen(null, 'files', false)).toBe(false)
  writeOpen(null, 'files', true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/ui/components/ui/accordion-state.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`accordion-state.ts`: `readOpen` parses `storage.getItem('remote-agent.accordion.v1')` in try/catch, returns `typeof map[id] === 'boolean' ? map[id] : fallback`. `writeOpen` merges into the object and calls `setItem` in try/catch. Both return early only for `null` storage using braces.

`accordion.tsx`: a `button` with `aria-expanded` and `aria-controls` containing the title and a `ChevronDown` icon that rotates when open; body rendered only when open. Initial state `readOpen(browserStorage(), id, defaultOpen ?? false)`; on toggle call `writeOpen`. `browserStorage()` returns `window.localStorage` inside try/catch or `null`. Style: `rounded-xl bg-card ring-1 ring-border/60`, title in `font-display font-semibold text-sm`, matching the existing `SectionLabel`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/ui/components/ui/accordion-state.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ui/accordion-state.ts src/ui/components/ui/accordion-state.test.ts src/ui/components/ui/accordion.tsx
git commit -m "feat(ui): add a shared accordion with remembered open state"
```

---

### Task 3: Render accordions in the chat info panel

**Files:**
- Modify: `src/ui/components/details/SessionDetails.tsx`, `BookmarksSection.tsx`, `ForksSection.tsx`, `TechnicalSection.tsx`
- Test: `src/ui/components/details/SessionDetails.test.tsx` (create; use the same render helper the existing UI tests in `src/ui` use, check `ls src/ui/components/*.test.tsx` first)

**Interfaces:**
- Consumes: `Accordion` (Task 2), `chatInfoSections()` and `ChatInfoSectionContext` (Task 1).
- Produces: nothing new. `SessionDetails` now renders each registered section as `<Accordion id={`ext:${section.id}`} title={section.title}>` after `TechnicalSection`, before `ManageSection`, with `render({ chat, openPanel, notify: onNotify, density })`. `openPanel` and `density` come from props: add `openPanel` and `density` to `SessionDetails` props, passed from `ChatInfo` (which receives them from `app.tsx`, the same way `SideTab` gets them today, see `app.tsx:707`).

- [ ] **Step 1: Write the failing test**

Render `SessionDetails` with one registered chat-info section whose render returns `<p>changed files here</p>`; assert the text is present and that its title appears in a button with `aria-expanded`. Assert the host's `BookmarksSection` title is also a button (so host sections use the new `Accordion`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/ui/components/details/SessionDetails.test.tsx`
Expected: FAIL, the section is not rendered.

- [ ] **Step 3: Implement**

In `SessionDetails`, after `<TechnicalSection>`, map `chatInfoSections()` to `<Accordion key={section.id} id={`ext:${section.id}`} title={section.title}>{section.render({ chat, openPanel, notify: onNotify, density })}</Accordion>`. Convert `BookmarksSection`, `ForksSection`, `TechnicalSection` from `<details>` to `<Accordion id="bookmarks" title={<SectionLabel>…</SectionLabel>} defaultOpen={…}>`, keeping their existing content and their `defaultOpen` rule (Bookmarks open when there are pins, Forks open when there are forks, Technical closed). Return `null` from `TechnicalSection` as today when there is nothing to show.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/ui/components/details/`
Expected: PASS. Then run `bun run typecheck`, expected no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/details src/ui/components/chat-info.tsx src/ui/app.tsx
git commit -m "feat(ui): show extension sections as accordions in chat info"
```

---

### Task 4: Git output parsers (backend, pure)

**Files:**
- Create: `extensions/git/backend/parse.ts`
- Test: `extensions/git/backend/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type FileChange = { path: string; oldPath: string | null; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'; added: number | null; removed: number | null; binary: boolean }
  // added/removed are null when binary.
  export function parseStatusV2(output: string): { staged: FileChange[]; unstaged: FileChange[] }
  export function parseNumstat(output: string): Map<string, { added: number | null; removed: number | null; binary: boolean }>
  export type Commit = { sha: string; shortSha: string; author: string; at: number; subject: string; pushed: boolean }
  export function parseLog(output: string, pushedShas: Set<string>): Commit[]
  export type DiffHunk = { header: string; lines: Array<{ kind: 'context' | 'added' | 'removed' | 'meta'; oldLine: number | null; newLine: number | null; text: string }> }
  export function parseUnifiedDiff(text: string): { binary: boolean; hunks: DiffHunk[] }
  ```

Input formats the implementation must handle (the git command that produces each is in Task 5):
- status: `git status --porcelain=v2 -z --untracked-files=all`. Entries are NUL-separated; `2 ` (rename/copy) entries are followed by an extra NUL field holding the original path; `? path` is untracked; `u ` is conflicted; `1 XY ...` and `2 XY ...` carry the two-letter status (X = staged, Y = unstaged, `.` = none). A file with both X and Y set appears in both lists.
- numstat: `git diff --numstat -z` gives `added\tremoved\tpath\0`; binary shows `-\t-\tpath`. Renames in `-z` numstat use `added\tremoved\t\0old\0new\0`.
- log: `git log --format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e`, records separated by `\x1e`.

- [ ] **Step 1: Write the failing tests**

Use these exact cases:

```ts
test('paths with spaces and unicode survive -z parsing', () => {
  const out = '1 .M N... 100644 100644 100644 abc abc docs/My Notes ü.md\0'
  expect(parseStatusV2(out).unstaged.map(f => f.path)).toEqual(['docs/My Notes ü.md'])
})
test('rename entries carry the new path and the old one', () => {
  const out = '2 R. N... 100644 100644 100644 a b R100 new name.ts\0old name.ts\0'
  const [change] = parseStatusV2(out).staged
  expect([change?.path, change?.oldPath, change?.status]).toEqual(['new name.ts', 'old name.ts', 'renamed'])
})
test('a file staged and modified again appears in both lists', () => {
  const out = '1 MM N... 100644 100644 100644 a a a x.ts\0'
  const result = parseStatusV2(out)
  expect(result.staged.map(f => f.path)).toEqual(['x.ts'])
  expect(result.unstaged.map(f => f.path)).toEqual(['x.ts'])
})
test('untracked files are unstaged with status untracked', () => {
  expect(parseStatusV2('? new.ts\0').unstaged[0]).toMatchObject({ path: 'new.ts', status: 'untracked' })
})
test('numstat counts lines and reports binary files as binary', () => {
  const map = parseNumstat('3\t1\tsrc/a.ts\0-\t-\timage.png\0')
  expect(map.get('src/a.ts')).toEqual({ added: 3, removed: 1, binary: false })
  expect(map.get('image.png')).toEqual({ added: null, removed: null, binary: true })
})
test('log marks commits reachable from upstream as pushed', () => {
  const rec = (sha: string, subject: string) => `${sha}\x1f${sha.slice(0, 7)}\x1fAna\x1f1700000000\x1f${subject}\x1e`
  const commits = parseLog(rec('aaaa111aaaa', 'one') + rec('bbbb222bbbb', 'two'), new Set(['aaaa111aaaa']))
  expect(commits.map(c => [c.subject, c.pushed])).toEqual([['one', true], ['two', false]])
})
test('diff hunks number lines from the @@ header', () => {
  const diff = '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d\n'
  const { hunks, binary } = parseUnifiedDiff(diff)
  expect(binary).toBe(false)
  expect(hunks[0]?.lines.map(l => [l.kind, l.oldLine, l.newLine])).toEqual([['context', 1, 1], ['removed', 2, null], ['added', null, 2], ['added', null, 3]])
})
test('a binary diff has no hunks', () => {
  expect(parseUnifiedDiff('Binary files a/x.png and b/x.png differ\n')).toEqual({ binary: true, hunks: [] })
})
```

Also a test for the unborn case: `parseLog('', new Set())` returns `[]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test extensions/git/backend/parse.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `parse.ts`**

Split on `\0` for status and numstat, honouring the rename extra field. Map porcelain `X`/`Y` letters: `M` → modified, `A` → added, `D` → deleted, `R` → renamed, `C` → renamed, `T` → modified. Join numstat counts onto the status entries by path in `git.ts`, not here. For `parseUnifiedDiff`, track old and new line counters from each `@@ -a,b +c,d @@` header.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test extensions/git/backend/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/git/backend/parse.ts extensions/git/backend/parse.test.ts
git commit -m "feat(git): parse status, numstat, log and unified diff output"
```

---

### Task 5: Git repository operations and routes (backend)

**Files:**
- Create: `extensions/git/plugin.json`, `extensions/git/backend/git.ts`, `extensions/git/backend/routes.ts`, `extensions/git/backend/index.ts`
- Test: `extensions/git/backend/git.test.ts`, `extensions/git/backend/routes.test.ts`

**Interfaces:**
- Consumes: parser functions from Task 4 (`parseStatusV2`, `parseNumstat`, `parseLog`, `parseUnifiedDiff`, types `FileChange`, `Commit`, `DiffHunk`); `ExtensionApi` from `src/extension-sdk/index.ts`.
- Produces:
  ```ts
  // git.ts
  export type GitRun = (cwd: string, args: string[], options?: { input?: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  export const runGit: GitRun // Bun.spawn(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe' })
  export type RepoInfo = { repo: false } | { repo: true; root: string; branch: string | null; upstream: string | null; hasCommits: boolean }
  export function repoInfo(cwd: string, run?: GitRun): Promise<RepoInfo>
  export function statusOf(cwd: string, run?: GitRun): Promise<{ staged: FileChange[]; unstaged: FileChange[] }> // numstat joined in
  export function logOf(cwd: string, limit: number, run?: GitRun): Promise<Commit[]>
  export function commitFiles(cwd: string, sha: string, run?: GitRun): Promise<FileChange[]>
  export function fileDiff(cwd: string, path: string, scope: 'staged' | 'unstaged' | 'commit', sha: string | null, run?: GitRun): Promise<{ binary: boolean; hunks: DiffHunk[] }>
  // routes.ts
  export function createGitRoutes(deps: { run?: GitRun }): {
    repo(request: Request): Promise<Response>        // GET ?cwd=
    status(request: Request): Promise<Response>      // GET ?cwd=
    log(request: Request): Promise<Response>         // GET ?cwd=&limit=
    commitFiles(request: Request): Promise<Response> // GET ?cwd=&sha=
    diff(request: Request): Promise<Response>        // GET ?cwd=&path=&scope=&sha=
    stage(request: Request): Promise<Response>       // POST { cwd, paths }
    unstage(request: Request): Promise<Response>     // POST { cwd, paths }
    commit(request: Request): Promise<Response>      // POST { cwd, message }
  }
  ```
  Errors are `{ error: string }` with 400 (validation), 404 (not in a repository, or path not in status), or 500 (git failed; the message is git's stderr).

- [ ] **Step 1: Write the failing tests**

`git.test.ts` builds real temporary repositories (`mkdtempSync` in the OS temp dir; this is test setup, not runtime code) and calls `statusOf`, `logOf`, `fileDiff`, `repoInfo` through the real `runGit`. Cases:
- "unborn HEAD": a repo with one staged file and no commits: `logOf` returns `[]`, `statusOf().staged` lists the file with counts.
- "numstat joins counts": after editing a committed file, `statusOf().unstaged` has `added: 1, removed: 0`.
- "binary numstat is reported as binary": commit a small binary file, change it, check `binary: true` and `added: null`.
- "subfolder launch reports repo true with the repository root": `repoInfo(join(repo, 'sub'))` has `repo: true` and `root` equal to the repository root.
- "folder that is not a repo reports repo false": `repoInfo(tmpDirOutsideAnyRepo)` → `{ repo: false }`.

`routes.test.ts` uses the real `createGitRoutes` on temporary repositories:
- "commit refuses empty message": POST `{ cwd, message: '   ' }` → 400.
- "commit refuses nothing staged": → 400 with an error mentioning nothing staged.
- "commit with a message starting with a dash is passed safely": stage a file, message `-n tricky`, expect 200 and `git log -1 --format=%s` to equal `-n tricky`.
- "stage refuses a path that is not in status": paths `['../secret']` → 404.
- "unstage in a repository without commits" works (`git rm --cached` path) and leaves the file untracked.
- "a missing cwd is a 400": `cwd: '/no/such/dir'` → 400.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/git/backend/`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`plugin.json`:
```json
{
  "id": "remote-agent.git",
  "name": "Git",
  "version": "0.1.0",
  "frontend": { "entry": "./frontend/index.tsx" },
  "backend": { "entry": "./backend/index.ts" },
  "permissions": ["http-routes"]
}
```

`git.ts`: `runGit` uses `Bun.spawn(['git', '-C', cwd, ...args], { stdin: input === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' })`, writes `input` when given, awaits both streams and `exited`. Set env `GIT_TERMINAL_PROMPT=0`. `statusOf` runs `status --porcelain=v2 -z --untracked-files=all`, then `diff --numstat -z` and `diff --cached --numstat -z`, and joins counts by path. Untracked files get `added` = line count of the file (read it with `Bun.file`), `removed: 0`. `logOf` runs `log -n <limit> --format=…`; the pushed set comes from `rev-list @{u}` when an upstream exists (empty set otherwise, so every commit is local). `fileDiff` runs `diff --cached -- path` (staged), `diff -- path` (unstaged), `show --format= sha -- path` (commit); for untracked files run `diff --no-index -- /dev/null path` and accept exit code 1. `repoInfo` returns `{ repo: false }` when `rev-parse --show-toplevel` fails or `cwd` is not an absolute existing directory.

`routes.ts`: each handler validates first (`cwd` absolute and existing, `paths` array of strings, `message` trimmed non-empty), then checks `repoInfo`, then for `stage`/`unstage`/`diff` checks each path is in `statusOf` output; use braces for every `if`. Return `Response.json`. `commit`: refuse when nothing is staged (check `statusOf().staged.length`), run `commit -m` with the message as an argv element (`['commit', '-m', message]`), return `{ sha }` from `rev-parse HEAD`. For `stage`, `git add -- …paths`; for `unstage`, `restore --staged -- …paths` when `hasCommits`, else `rm --cached -q -- …paths`.

`index.ts`:
```ts
import type { ExtensionApi } from '../../../src/extension-sdk/index.ts'
import { createGitRoutes } from './routes.ts'

export function onActivate(api: ExtensionApi) {
  const routes = createGitRoutes({})
  api.backend.registerHttpRoute('GET', '/repo', request => routes.repo(request))
  api.backend.registerHttpRoute('GET', '/status', request => routes.status(request))
  api.backend.registerHttpRoute('GET', '/log', request => routes.log(request))
  api.backend.registerHttpRoute('GET', '/commit-files', request => routes.commitFiles(request))
  api.backend.registerHttpRoute('GET', '/diff', request => routes.diff(request))
  api.backend.registerHttpRoute('POST', '/stage', request => routes.stage(request))
  api.backend.registerHttpRoute('POST', '/unstage', request => routes.unstage(request))
  api.backend.registerHttpRoute('POST', '/commit', request => routes.commit(request))
}
```
Route handlers return `Response | null` per the SDK type; return the response, never `null`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/git/backend/`
Expected: PASS. Then `bun test` for the whole suite, expected no new failures.

- [ ] **Step 5: Commit**

```bash
git add extensions/git
git commit -m "feat(git): add the git extension backend with validated routes"
```

---

### Task 6: Frontend client, tree building and open-files persistence

**Files:**
- Create: `extensions/git/frontend/client.ts`, `extensions/git/frontend/tree.ts`, `extensions/git/frontend/open-files.ts`
- Test: `extensions/git/frontend/tree.test.ts`, `extensions/git/frontend/open-files.test.ts`

**Interfaces:**
- Consumes: response shapes from Task 5 (`FileChange`, `Commit`, `DiffHunk`, `RepoInfo`).
- Produces:
  ```ts
  // client.ts: all calls prefix '/api/extensions/remote-agent.git' and throw Error(body.error) on non-2xx
  export const gitApi: {
    repo(cwd: string): Promise<RepoInfo>
    status(cwd: string): Promise<{ staged: FileChange[]; unstaged: FileChange[] }>
    log(cwd: string, limit?: number): Promise<Commit[]>
    commitFiles(cwd: string, sha: string): Promise<FileChange[]>
    diff(cwd: string, path: string, scope: 'staged' | 'unstaged' | 'commit', sha?: string): Promise<{ binary: boolean; hunks: DiffHunk[] }>
    stage(cwd: string, paths: string[]): Promise<void>
    unstage(cwd: string, paths: string[]): Promise<void>
    commit(cwd: string, message: string): Promise<{ sha: string }>
  }
  // tree.ts
  export type TreeNode = { name: string; path: string; kind: 'folder'; added: number; removed: number; children: TreeNode[] } | { name: string; path: string; kind: 'file'; file: FileChange }
  export function buildTree(files: FileChange[]): TreeNode[]
  export function displayPath(path: string, launchRelativeRoot: string): string  // see Task 9 for launch-relative logic
  // open-files.ts
  export type OpenDiff = { path: string; scope: 'staged' | 'unstaged' | 'commit'; sha?: string }
  export function readOpenDiffs(storage: OpenStateStorage | null, chatId: string): OpenDiff[]
  export function writeOpenDiffs(storage: OpenStateStorage | null, chatId: string, diffs: OpenDiff[]): void
  ```
  `OpenStateStorage` is the type from `src/ui/components/ui/accordion-state.ts` (Task 2). Storage key `remote-agent.git.open-files.v1`, value `{ [chatId]: OpenDiff[] }`.

- [ ] **Step 1: Write the failing tests**

`tree.test.ts`:
- "folders sum their children's counts": files `a/x.ts (+2 −1)`, `a/b/y.ts (+3 −0)` → top folder `a` has `added 5, removed 1`.
- "folders with a single child folder are not collapsed into one name" is NOT required; instead: "files at the top level sit beside folders in name order, folders first".
- "a binary file counts as zero" → `added: 0` on its folder.

`open-files.test.ts`:
- "each chat keeps its own open diffs".
- "a throwing store reads as empty and writes nothing".
- "a corrupt value reads as empty".

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/git/frontend/tree.test.ts extensions/git/frontend/open-files.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`client.ts` builds URLs with `URLSearchParams`, sends `POST` bodies as JSON, and throws on non-2xx using the `error` field of the JSON body. `tree.ts` groups by path segments, creates folder nodes, sorts folders first then name, and sums counts (binary counts as 0). `open-files.ts` reads/writes the map in try/catch and drops malformed entries (any entry whose `path` is not a string or `scope` is not one of the three values).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/git/frontend/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/git/frontend
git commit -m "feat(git): add the frontend client, tree builder and per-chat open diffs"
```

---

### Task 7: Syntax-highlighted diff rendering

**Files:**
- Modify: `package.json` (add `"shiki"` to dependencies, via `bun add shiki`)
- Create: `extensions/git/frontend/highlight.ts`
- Test: `extensions/git/frontend/highlight.test.ts`

**Interfaces:**
- Consumes: `DiffHunk` (Task 4 type).
- Produces:
  ```ts
  export function languageOf(path: string): string   // 'typescript' | 'tsx' | 'javascript' | 'json' | 'markdown' | 'css' | 'html' | 'python' | 'text' ...
  export function highlightLine(code: string, lang: string): Promise<string>  // returns HTML with inline colors, escaped
  export function escapeHtml(text: string): string   // used by the fallback
  ```
  `highlightLine` loads `shiki` with `await import('shiki')` on first use, uses `codeToHtml` with the `github-light`/`github-dark` themes (dual themes via `themes: { light, dark }`), and returns the escaped text if `shiki` fails to load or the language is unknown.

- [ ] **Step 1: Write the failing tests**

- "languageOf maps extensions and falls back to text": `languageOf('a/b.tsx') === 'tsx'`, `languageOf('x.unknownext') === 'text'`.
- "escapeHtml escapes markup": `escapeHtml('<a href="x">&</a>') === '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;'`.
- "highlightLine escapes output when the language is unknown": `await highlightLine('<b>', 'text')` contains `&lt;b&gt;` and no `<b>`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/git/frontend/highlight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Run `bun add shiki` first, and check the resolved version is at least two weeks old before accepting it. Implement the three functions as specified. Cache the highlighter promise in a module variable so `shiki` loads once.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/git/frontend/highlight.test.ts && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock extensions/git/frontend/highlight.ts extensions/git/frontend/highlight.test.ts
git commit -m "feat(git): add lazy syntax highlighting for diffs"
```

---

### Task 8: Diff main panel

**Files:**
- Create: `extensions/git/frontend/DiffPanel.tsx`
- Test: `extensions/git/frontend/DiffPanel.test.tsx`

**Interfaces:**
- Consumes: `gitApi.diff` (Task 6), `highlightLine`, `languageOf` (Task 7), `OpenDiff` (Task 6), `PanelContext` from `src/ui/extension-slots.ts`, `Button` from `src/ui/components/ui/button.tsx`.
- Produces:
  ```tsx
  // Panel id: 'git.diff'. Params: { cwd: string; path: string; scope: 'staged'|'unstaged'|'commit'; sha?: string; chatId: string }
  export function DiffPanel(context: PanelContext): JSX.Element
  ```
  The panel header shows the path (full, with `truncate` and `break-all` on narrow screens) and `+added −removed`, and a close button that calls `closePanel()`. The body is a `<pre>` per hunk with a line-number gutter and the highlighted line text. On a phone the body scrolls horizontally inside its own container; on wide screens it fills the main area. A binary file shows "Binary file: no text diff". Long diffs (over 2,000 lines) render the first 2,000 with a "Show all" button.

- [ ] **Step 1: Write the failing tests**

With `gitApi.diff` mocked by injection (the component takes a `fetchDiff` prop defaulting to `gitApi.diff`, so tests pass a fake):
- "header shows the path and counts".
- "a binary file shows the binary message and no hunks".
- "truncates after 2,000 lines and shows Show all".

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/git/frontend/DiffPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Read `context.params` into `{ cwd, path, scope, sha }`, call `fetchDiff` in a `useEffect`, store `{ binary, hunks }` and a loading/error state. Highlight lines with `highlightLine` in an effect, keyed by hunk, falling back to escaped text while loading. Shell classes: `bg-card` for the panel, `bg-emerald-500/10` for added lines, `bg-red-500/10` for removed lines. Use `min-w-0 flex-1` on the container so it works inside the main area on both layouts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/git/frontend/DiffPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/git/frontend/DiffPanel.tsx extensions/git/frontend/DiffPanel.test.tsx
git commit -m "feat(git): add the syntax-highlighted diff panel"
```

---

### Task 9: Git side tab (sections, staging, log, commit)

**Files:**
- Create: `extensions/git/frontend/StatusTree.tsx`, `extensions/git/frontend/CommitLog.tsx`, `extensions/git/frontend/CommitDialog.tsx`, `extensions/git/frontend/GitSideTab.tsx`
- Test: `extensions/git/frontend/GitSideTab.test.tsx`

**Interfaces:**
- Consumes: `gitApi` (Task 6), `buildTree` (Task 6), `Accordion` (Task 2), `SideTabContext` (`src/ui/extension-slots.ts`), `openDiffPanel` helper (below), `writeOpenDiffs`/`readOpenDiffs` (Task 6).
- Produces:
  ```tsx
  export function GitSideTab(context: SideTabContext & { fetchers?: typeof gitApi }): JSX.Element
  // StatusTree
  export function StatusTree(props: { files: FileChange[]; mode: 'staged' | 'unstaged'; onOpen(file: FileChange): void; onStage(paths: string[]): void; onUnstage(paths: string[]): void }): JSX.Element
  // CommitLog
  export function CommitLog(props: { commits: Commit[]; cwd: string; onOpen(file: FileChange, sha: string): void }): JSX.Element
  // CommitDialog
  export function CommitDialog(props: { open: boolean; message: string; staged: FileChange[]; onCancel(): void; onConfirm(): void }): JSX.Element
  ```
  `openDiffPanel(context, cwd, chatId, diff)` calls `context.openPanel('git.diff', { cwd, chatId, path, scope, sha? })` and writes the open list with `writeOpenDiffs`.

  Layout (top to bottom): header row with title "Git" on the left and a `RefreshCw` icon button on the right; then three `Accordion`s, "Staged changes · N", "Changes · N", "Git log"; the commit form sits in the Staged accordion's footer: a `textarea` labelled "Commit message" and a "Commit" button (`disabled` when nothing staged or the message is blank). The Git tab shows an empty state "No git repository in this chat's folder" when `repo.repo` is false, and "Open a chat to see its repository" when `activeChat` is null.

- [ ] **Step 1: Write the failing tests**

Using a fake `fetchers` object:
- "shows the empty state when the chat folder is not a repository".
- "Commit is disabled until something is staged and a message is typed".
- "clicking a staged file calls openPanel with the staged scope".
- "confirming the commit dialog calls commit once and refreshes status".
- "cancelling the commit dialog does not call commit".
- "refresh button reloads status and log".

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/git/frontend/GitSideTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`GitSideTab`: keep state `{ repo, staged, unstaged, commits, message, confirming, busy }`. On mount and when `activeChat?.id` or `launchCwd` changes, call `gitApi.repo(cwd)` then load status and log. The `cwd` is `activeChat.launchCwd` (skip loading when null). Stage/unstage calls the API then reloads. Commit: confirm dialog, then `gitApi.commit`, clear the message on success, reload; errors go to `context.notify(message, 'error')`. `StatusTree` renders `buildTree(files)` recursively: folders as collapsible rows with `+added −removed`, files as rows with name, counts, and a stage/unstage icon button (`Plus` / `Minus` icons from lucide). Clicking the file name calls `onOpen`. `CommitLog` lists commits (short sha, subject, author, relative time, a "Local" or "Pushed" badge); clicking a commit loads `gitApi.commitFiles` and shows the files as a nested list beneath it; clicking a file calls `onOpen(file, sha)`. Open-diff writes happen in `openDiffPanel`, called from the Git tab, the chat-info section (Task 10) and the log.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/git/frontend/GitSideTab.test.tsx && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/git/frontend
git commit -m "feat(git): add the Git side tab with staging, log and commit"
```

---

### Task 10: Chat-info "File changes" section and registrations

**Files:**
- Create: `extensions/git/frontend/ChangedFilesSection.tsx`, `extensions/git/frontend/index.tsx`
- Modify: `src/ui/extensions.ts` (add `import '../../extensions/git/frontend/index.tsx'` after the terminal import)
- Test: `extensions/git/frontend/ChangedFilesSection.test.tsx`

**Interfaces:**
- Consumes: `registerChatInfoSection`, `registerSideTab` (`src/ui/extension-slots.ts`), `registerPanel` (`src/ui/components/extension-registry.tsx`), `gitApi`, `openDiffPanel`, `GitSideTab`, `DiffPanel`, `ChatInfoSectionContext`.
- Produces: `export function ChangedFilesSection(context: ChatInfoSectionContext & { fetchers?: typeof gitApi }): JSX.Element`.
  The section lists the staged and unstaged files as one flat list (no tree): each row shows the file name in bold, the path relative to `launchCwd` in muted text (with `../` for files outside it), and `+added −removed`. Clicking a row calls `openDiffPanel` with scope `unstaged` for unstaged files and `staged` for staged files. Shows "No changes" when empty and nothing when the chat has no repository.

  Registrations in `index.tsx`:
  ```ts
  registerSideTab('git', { title: 'Git', icon: GitBranch, render: context => <GitSideTab {...context} /> })
  registerChatInfoSection('git.changes', 'File changes', context => <ChangedFilesSection {...context} />)
  registerPanel('git.diff', DiffPanel, 'Diff')
  ```

- [ ] **Step 1: Write the failing tests**

- "lists changed files flat with counts and paths relative to the launch folder".
- "a file outside the launch folder shows with ../".
- "clicking a row opens the diff panel with the right scope".
- "a chat with no repository renders nothing".

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/git/frontend/ChangedFilesSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Relative path: `relativeTo(launchCwd, repoRoot, filePath)`, computed from `repo.root` (returned by `gitApi.repo`) and the file path (repo-relative), producing a path from `launchCwd` with `../` segments as needed. Put that helper in `tree.ts` as `displayPath` (the signature stub from Task 6 becomes `displayPath(filePath: string, repoRoot: string, launchCwd: string): string`); add a test case for it in `tree.test.ts` ("a file in a subfolder of the launch folder shows without ../" and "a file outside shows with ../"). Register in `index.tsx` as above. Add the composition-root import in `src/ui/extensions.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/git && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/git/frontend src/ui/extensions.ts
git commit -m "feat(git): add the File changes section and register the git extension"
```

---

### Task 11: Full verification

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: all tests pass. Any failure is fixed in the task that owns the file, then committed.

- [ ] **Step 2: Typecheck and build**

Run: `bun run typecheck && bun run build`
Expected: no errors.

- [ ] **Step 3: Manual check in a browser at two widths**

Start the dev server with `bun run dev` and open a chat whose `launchCwd` is a git repository with at least one staged file, one unstaged file and one commit that is not pushed. Check at a phone width (about 390px) and at a desktop width: the Git tab sections, the stage/unstage buttons, the commit confirmation, the chat-info "File changes" accordion, and the diff panel with highlighting. Report what you saw; if the browser check cannot run here, say so instead of claiming it passed.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(git): address verification findings"
```
(Skip this step when nothing changed.)

---

## Self-Review

- **Spec coverage:** slot (Task 1), accordion redesign (Tasks 2–3), Git side tab with three sections, staging, commit (Task 9), commit confirmation (Task 9), diff panel (Tasks 7–8), chat-info "File changes" accordion (Task 10), launch-folder check and active-chat-only (Tasks 5, 9, 10), per-chat localStorage (Task 6 and used in Tasks 8–10), pushed/local badge (Tasks 4, 9), relative paths (Tasks 6, 10). Covered.
- **Amendment:** routes take `cwd` instead of `chatId`, plus stage/unstage routes; recorded in Global Constraints for the user to review.
- **Type consistency:** `FileChange`, `Commit`, `DiffHunk`, `RepoInfo` defined in Task 4/5 and reused; `OpenStateStorage` from Task 2 reused in Task 6; `displayPath` signature stated in Task 6 and completed in Task 10; `gitApi` fetchers passed as `fetchers` prop in Tasks 9–10.
- **Dependency:** `shiki` (Task 7) must be version-checked as at least two weeks old before install.
- **Open:** the Git side tab's header refresh runs the same loader as mount; a refresh when a session becomes idle is in the spec and is not in a task. Add it in Task 9 when implementing: subscribe to `activeChat.status` change and call the loader.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-17-git-extension.md`. Please review the plan. Does it capture what you want?

Two things to check in particular:
- **Routes take `cwd`, not `chatId`.** The extension backend can't read chats, so the client sends the chat's `launchCwd` and the server checks it. This changes approved Decision 5. The server still runs only fixed git commands and refuses paths that aren't in git status.
- **Stage and unstage routes** were added to the list, as approved under Decision 7.

Which execution approach would you prefer?

- **Subagent-driven**: a fresh subagent implements each task, and a fresh reviewer checks it before the next starts, then a whole-branch review. Most thorough, but costs a fresh context per task and per review.
- **Native**: I implement every task in this session, then one fresh reviewer checks the whole branch. Cheapest and fastest, but no independent review until the end.

For this plan I recommend **Subagent-driven**, because the eleven tasks depend on each other's interfaces (the parsers feed the routes, which feed the client and the UI), and a shipped mistake in the commit path would be hard to undo. Does the plan capture what you want, and which approach should we use?

