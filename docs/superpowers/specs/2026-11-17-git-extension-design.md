# Git extension + chat-info accordion slot: design

Date: 2026-11-17
Status: approved 2026-11-17 (stage/unstage controls and `shiki` approved; Commit asks for confirmation)
Branch: `feat/git-extension` (branched from `feat/terminal-sessions`, which holds the side-panel tabs and chat-action slots this builds on; those are not on `main` yet)
Glossary: [`CONTEXT.md`](../../../CONTEXT.md)
Builds on: [Extensions + terminal plugin](2026-11-15-extensions-terminal-plugin-design.md), [Side panel activity bar](2026-11-16-side-panel-activity-bar-design.md)

## Intent

When a Claude Code session changes files, the person running it often wants to review those changes and commit them, from a phone as easily as from a desk. Today the web chat shows the session but not its repository. This adds a Git extension that works inside the chat: a Git side tab for the active chat's repository, a file-changes accordion in the chat info panel, and a diff viewer in the main area.

Why an extension rather than core code: git is one capability among many, and the host should not learn about repositories. The host only gains two generic slots (a chat-info accordion and the existing side tab and panel slots), and the Git extension fills them.

## Goals

- **Chat-info accordion slot.** `registerChatInfoSection(id, title, renderer)`. Each call is its own accordion with its own title and content. Registering again with the same id replaces that accordion; different ids are different accordions.
- **Git is active only for the active chat**, and only when its `launchCwd` is inside a git repository. Otherwise the Git tab shows an empty state and the chat-info accordion is not rendered.
- **Git side tab** titled "Git", refresh button in the header's right corner, then accordion sections:
  1. **Staged changes**: staged files as a tree, each directory with a summary, each file with `+added −removed`.
  2. **Changes**: unstaged and untracked files, same tree and summary.
  3. **Git log**: commits with a badge for local-only or pushed. Clicking a commit lists its changed files; clicking a file opens the diff.
- **Commit**: a message input and a Commit button that commits the staged files.
- **Diff viewer** in the main area, titled with the file path. Syntax-highlighted unified diff. Works on phones and on wide screens.
- **Chat-info accordion** "File changes": a flat list of changed files, each row showing the name, `+added −removed`, and the path relative to `launchCwd`. Clicking a row opens the diff.
- **Open files persist per chat** in `localStorage`, so each chat remembers its own open diff tabs.

## Non-goals (v1)

- Push, pull, fetch, branch switching, merge, stash, rebase, discard changes.
- Editing files, resolving conflicts, hunk-level staging.
- Multiple repositories per chat. One repository: the one containing `launchCwd`.
- Any git work when the chat is not the active one.

## Anti-goals

- Running shell strings. Every git call is a `Bun.spawn` with an argument array and a fixed working directory. Paths from the client are checked against the repository before use.
- The host learning anything about git. `src/` gains only the slot; the git code lives in `extensions/git/`.
- A second tree widget or accordion style than the ones the host defines.

## Constraints

- The chat-info panel is a column on desktop and a sheet on phones (`DetailsPanel`). Both must work.
- `CONTEXT.md` language: a Chat is per Session; `launchCwd` is the folder the Session started in.
- Coding rule: no short-if early returns in TypeScript (use braces).
- Commits are not reversible from the app. The Commit button is the only write action and always asks for confirmation (see Decision 8).

## Decisions (my calls, change any before the plan)

1. **Slot shape.** `src/ui/extension-slots.ts` gains:
   ```ts
   registerChatInfoSection(id: string, title: string, render: (context: ChatInfoSectionContext) => ReactNode): void
   chatInfoSections(context): Array<{ id, title, node }>
   ```
   `ChatInfoSectionContext = { chat: Chat; openPanel: OpenPanel; notify: Notify; density }`. Sections render in registration order. Same id replaces the earlier one. Unlike the side tab, it does not need an icon.

2. **Accordion component.** One shared `Accordion` (title row with chevron, body, `aria-expanded`, keyboard toggle) under `src/ui/components/ui/accordion.tsx`. The existing `details` sections in `details/` move onto it, so the look is consistent. The host's own sections keep their content; only the wrapper changes. Open/closed state is kept per section id in `localStorage`.

3. **Side tab and context.** Registered with `registerSideTab('git', { title: 'Git', icon: GitBranch, render })`. It reads `activeChat` from `SideTabContext`. When `activeChat` is null or has no git repo, it shows an empty state.

4. **Which folder.** `launchCwd`, as asked. The backend resolves the repository root with `git -C <launchCwd> rev-parse --show-toplevel`. Paths shown to the user are relative to `launchCwd`; files outside it appear with `../`. If `launchCwd` is null, the extension treats the chat as having no repository.

5. **Routes.** Namespaced under `/api/extensions/remote-agent.git/`:
   - `GET /repo?chatId=` → `{ repo: boolean, root, branch, upstream }`
   - `GET /status?chatId=` → staged and unstaged entries with numstat counts
   - `GET /log?chatId=&limit=` → commits with `pushed: boolean`
   - `GET /commit?chatId=&sha=` → changed files for a commit
   - `GET /diff?chatId=&path=&scope=staged|unstaged|commit&sha=` → unified diff text
   - `POST /commit` `{ chatId, message }` → commits the staged set
   Every route takes `chatId` and resolves the folder on the server; the client never sends a path that is run directly.

6. **Pushed or local.** A commit is "pushed" when it is reachable from the upstream branch (`git merge-base --is-ancestor <sha> @{u}`). With no upstream, all commits show "local".

7. **Staging.** The app needs a way to stage, or the Staged section is always empty. My call: per-file and per-folder **stage / unstage** buttons in the Changes section, and a Staged section with the same unstage buttons. This is the one place where I added a control you did not list. Say if you want it removed.

8. **Commit action.** The Commit button is disabled when nothing is staged or the message is empty. Pressing it opens a confirmation dialog that lists the staged files with their counts and shows the message; only "Commit" in that dialog sends `POST /commit`. The commit uses `git commit -m` (message passed as an argument, never through a shell). After success the Staged and Changes sections and the log refresh. Failures show the git error text as an error toast.

9. **Diff rendering.** Unified diff parsed on the server into hunks; the client highlights each hunk with the file's language. On a phone the diff scrolls horizontally inside a single column; on wide screens it is the main area's full width with line numbers. The main-area panel's header shows the file path and its `+added −removed`.

10. **Syntax highlighting.** Needs a dependency. My pick: `shiki`, loaded lazily only when a diff opens, so the main bundle does not grow. This is a new dependency and needs your approval.

11. **Tree view.** Built from paths on the client: folders collapsed by default when more than 20 files; each folder row shows the sum of its children's `+added −removed`.

12. **Persistence.** `localStorage` key `remote-agent.git.open-files.v1`, a map from `chatId` to the list of open diff tabs (`{ path, scope, sha? }`). Stored per chat, try/catch around every access. Restored when the chat opens. Closing a tab removes it from the list.

13. **Refresh.** The Git tab refreshes on the header button and when the chat's session status changes to idle. No polling in v1.

## Parts

- `src/ui/extension-slots.ts`: `registerChatInfoSection`, `chatInfoSections`, context type.
- `src/ui/components/ui/accordion.tsx`: shared accordion.
- `src/ui/components/details/DetailsPanel.tsx` / `SessionDetails.tsx`: renders the registered sections after the host's own sections, each inside `Accordion`.
- `extensions/git/plugin.json`: `id: remote-agent.git`, permissions `["http-routes", "storage"]` (storage only if the open-files map moves to the platform later; v1 uses localStorage, so `http-routes` alone).
- `extensions/git/backend/`: `git.ts` (argument-array runner, numstat and status parsing, log parsing, unified-diff hunks), `routes.ts`, `index.ts`.
- `extensions/git/frontend/`: `index.tsx` (registrations), `GitSideTab.tsx`, `StatusTree.tsx`, `CommitLog.tsx`, `DiffPanel.tsx`, `ChangedFilesSection.tsx`, `open-files.ts` (localStorage), `client.ts` (fetch wrappers).
- Tests: parsers (`git.test.ts`) against fixture output from a temporary repository; routes against a temporary repository; slot registration and replacement; open-files persistence with a throwing storage.

## Flow

1. Person opens a chat whose `launchCwd` is a repository. The chat-info panel shows the "File changes" accordion; the side tab "Git" shows sections.
2. Clicking a file in either place opens a main-area diff panel with that file's path in its header. The open tab is written to `localStorage` for this chat.
3. Staging and unstaging call the routes, then refresh the sections.
4. Commit: type message, press Commit. The route commits staged files; sections and log refresh.

## What's left to the builder

These are minor; I will settle them and mark them in the plan:

- Exact icon for the Git tab (`GitBranch`).
- Empty-state copy when a chat has no repository.
- Limits: diffs over 2,000 lines are truncated with a "show more" link.
- Route error shape: `{ error: string }` with status 4xx/5xx, matching the existing extension routes.

## Calls I made, for review

- Branched from `feat/terminal-sessions`, not `main`.
- Paths relative to `launchCwd`, with `../` for files outside it.
- Stage and unstage controls added (Decision 7), approved.
- `shiki` as the highlighter (Decision 10), approved.
- Commit asks for confirmation before running (Decision 8), per your answer.

Approved. Next step: the implementation plan.
