import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, FolderGit2, GitBranch, MessageSquareText, Plus, RefreshCw } from 'lucide-react'
import type { Commit, FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'
import type { OpenPanel, SideTabContext } from '../../../src/ui/extension-slots.ts'
import { Accordion } from '../../../src/ui/components/ui/accordion.tsx'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { Textarea } from '../../../src/ui/components/ui/textarea.tsx'
import { SidePanelEmptyState } from '../../../src/ui/components/side-panel/SidePanelEmptyState.tsx'
import { SidePanelHeader } from '../../../src/ui/components/side-panel/SidePanelHeader.tsx'
import { gitApi } from './client.ts'
import { CommitDialog } from './CommitDialog.tsx'
import { CommitLog } from './CommitLog.tsx'
import { addOrActivate } from './diff-tabs.ts'
import { browserStorage, type OpenDiff, readOpenDiffs, writeOpenDiffs } from './open-files.ts'
import { SectionTotals, StatusTree, TreeFileRow } from './StatusTree.tsx'
import { draftKey, readDraft, writeDraft } from './commit-draft.ts'
import { readComments, subscribeCommentsChanged } from './comments.ts'
import { AttachCommentsControl, runAttachComments } from './CommentEditor.tsx'

export type Scope = 'staged' | 'unstaged' | 'commit'
export type GitState = { status: { staged: FileChange[]; unstaged: FileChange[] }; commits: Commit[] }
/** `from` is the chat the diff was opened from: closing the diff panel goes back there. */
export type DiffParams = { cwd: string; chatId: string; path: string; scope: Scope; sha?: string; from?: string }
export type WriteOpen = (chatId: string, diff: OpenDiff) => void
/** The snapshot the commit dialog shows and approves: the staged files as reloaded, and the message. */
export type CommitReview = { staged: FileChange[]; message: string }

type RepoApi = Pick<typeof gitApi, 'repo' | 'status' | 'log'>
type StatusLogApi = Pick<typeof gitApi, 'status' | 'log'>
type CommitApi = Pick<typeof gitApi, 'commit' | 'status'>

/** The commit draft carries over only within one folder: a different folder starts with an empty draft. */
export function draftFor(previousCwd: string | null, nextCwd: string | null, draft: string): string {
  return previousCwd === nextCwd ? draft : ''
}

/** Whether a response requested for `requestedCwd` still belongs to the folder shown now. */
export function isCurrentCwd(latestCwd: string | null, requestedCwd: string): boolean {
  return latestCwd === requestedCwd
}

/** Whether the agent going from busy to idle means the Git state must be read again. True only for busy to idle. */
export function shouldRefreshOnIdle(previousBusy: boolean, busy: boolean): boolean {
  return previousBusy && !busy
}

/** The conventional commit types the picker offers, in menu order. */
export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'] as const
export type CommitType = (typeof COMMIT_TYPES)[number]

const COMMIT_PREFIX = /^(feat|fix|docs|refactor|test|chore):\s*/

/** The known type the message starts with, or null. */
export function commitTypeOf(message: string): CommitType | null {
  const match = COMMIT_PREFIX.exec(message)
  return match === null ? null : (match[1] as CommitType)
}

/**
 * The message with its type prefix set to `type` ("type: "), replacing a known prefix when there is one. A null type removes
 * a known prefix. Text after the prefix is kept as it is.
 */
export function applyCommitType(message: string, type: CommitType | null): string {
  const body = message.replace(COMMIT_PREFIX, '')
  return type === null ? body : `${type}: ${body}`
}

/** The type a picker option stands for: '' is "none", which is null. */
export function commitTypeFromOption(value: string): CommitType | null {
  return COMMIT_TYPES.find((type) => type === value) ?? null
}

/** Splits files into the conflicted ones, shown in their own group, and the rest. */
export function splitConflicts(files: FileChange[]): { conflicted: FileChange[]; other: FileChange[] } {
  const conflicted: FileChange[] = []
  const other: FileChange[] = []
  for (const file of files) {
    if (file.status === 'conflicted') {
      conflicted.push(file)
    } else {
      other.push(file)
    }
  }
  return { conflicted, other }
}

/** Commit is allowed only when something is staged and the message is not blank. */
export function canCommit(staged: FileChange[], message: string): boolean {
  return staged.length > 0 && message.trim() !== ''
}

/** The line under the Commit button that says what is missing. Null when a commit can go ahead. */
export function commitHint(stagedCount: number, message: string): string | null {
  if (stagedCount === 0) {
    return 'Stage files to commit'
  }
  if (message.trim() === '') {
    return 'Write a commit message'
  }
  return null
}

/** The commit dialog opens only when the reloaded state still has something to commit; it lists exactly that reload. */
export function commitReviewAfterReload(staged: FileChange[], message: string): CommitReview | null {
  if (!canCommit(staged, message)) {
    return null
  }
  return { staged, message }
}

/**
 * Commits the staged changes once, then reads status back. `expectedPaths` is what the person reviewed; the server refuses a
 * different staged set. Errors propagate and status is not read.
 */
export async function commitStaged(
  api: CommitApi,
  cwd: string,
  message: string,
  expectedPaths?: string[],
): Promise<{ sha: string; status: GitState['status'] }> {
  const { sha } = await api.commit(cwd, message, expectedPaths)
  const status = await api.status(cwd)
  return { sha, status }
}

/** Reads status and the log for a folder. */
export async function loadGitState(api: StatusLogApi, cwd: string): Promise<GitState> {
  const [status, commits] = await Promise.all([api.status(cwd), api.log(cwd)])
  return { status, commits }
}

/** Opens the diff panel for a file and records it as open for the chat. */
export function openDiffPanel(openPanel: OpenPanel, writeOpen: WriteOpen, params: DiffParams): void {
  const panelParams: Record<string, string> = { cwd: params.cwd, chatId: params.chatId, path: params.path, scope: params.scope }
  const diff: OpenDiff = params.sha === undefined ? { path: params.path, scope: params.scope } : { path: params.path, scope: params.scope, sha: params.sha }
  if (params.sha !== undefined) {
    panelParams.sha = params.sha
  }
  if (params.from !== undefined) {
    panelParams.from = params.from
  }
  openPanel('git.diff', panelParams)
  writeOpen(params.chatId, diff)
}

/** Records a diff as open for a chat in the browser's storage. An already-open diff keeps its tab position. */
export function writeOpen(chatId: string, diff: OpenDiff): void {
  const storage = browserStorage()
  writeOpenDiffs(storage, chatId, addOrActivate(readOpenDiffs(storage, chatId), diff).list)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Git request failed'
}

async function readRepository(api: RepoApi, cwd: string): Promise<{ repo: RepoInfo; state: GitState | null }> {
  const repo = await api.repo(cwd)
  if (!repo.repo) {
    return { repo, state: null }
  }
  return { repo, state: await loadGitState(api, cwd) }
}

export type GitView = 'no-chat' | 'no-folder' | 'error' | 'loading' | 'not-repo' | 'repo'

/** Which view the tab shows. Checked in order: no chat, no folder, a failed load, a load in flight, not a repository, a repository. */
export function gitView(input: { hasChat: boolean; cwd: string | null; repo: RepoInfo | null; loadError: string | null }): GitView {
  if (!input.hasChat) {
    return 'no-chat'
  }
  if (input.cwd === null) {
    return 'no-folder'
  }
  if (input.repo === null && input.loadError !== null) {
    return 'error'
  }
  if (input.repo === null) {
    return 'loading'
  }
  if (!input.repo.repo) {
    return 'not-repo'
  }
  return 'repo'
}

function commitCount(count: number): string {
  return count === 1 ? '1 commit' : `${count} commits`
}

/**
 * The branch the repository is on, under the Git title. Detached HEAD shows as such. The upstream is shown after it when set,
 * then how many commits the branch is ahead (`↑N`) and behind (`↓N`) its upstream. Zero counts show nothing.
 */
export function BranchLine({ branch, upstream, ahead = 0, behind = 0 }: { branch: string | null; upstream: string | null; ahead?: number; behind?: number }) {
  const label = branch ?? 'Detached HEAD'
  return (
    <div className="flex min-w-0 items-center gap-1.5 pb-3 text-xs text-muted-foreground">
      <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate font-mono text-foreground" title={label}>{label}</span>
      {upstream === null ? null : <span className="min-w-0 shrink truncate">· {upstream}</span>}
      {ahead > 0 ? (
        <span className="shrink-0 font-mono" title={`${commitCount(ahead)} to push`}>{`↑${ahead}`}</span>
      ) : null}
      {behind > 0 ? (
        <span className="shrink-0 font-mono" title={`${commitCount(behind)} to pull`}>{`↓${behind}`}</span>
      ) : null}
    </div>
  )
}

/** The conventional-commit type picker: a labelled native select that shows the type the message already starts with. */
export function CommitTypeSelect({ message, onChange }: { message: string; onChange(message: string): void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">Commit type</span>
      <select
        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
        value={commitTypeOf(message) ?? ''}
        onChange={(event) => onChange(applyCommitType(message, commitTypeFromOption(event.target.value)))}
      >
        <option value="">none</option>
        {COMMIT_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The group of conflicted files at the top of the Changes section. Staging a file is how its resolution finishes. */
export function ConflictGroup({ files, onOpen, onStage }: { files: FileChange[]; onOpen(file: FileChange): void; onStage(paths: string[]): void }) {
  return (
    <section aria-label="Conflicts" className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-red-600 dark:text-red-400">
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{`Conflicts · ${files.length}`}</span>
      </div>
      <p className="px-1 text-xs text-muted-foreground">Resolve these in your editor, then stage them.</p>
      <ul className="flex flex-col">
        {files.map((file) => (
          <li key={file.path} className="h-7">
            <TreeFileRow
              file={file}
              name={file.path}
              depth={0}
              onOpen={() => onOpen(file)}
              trailing={
                <Button variant="ghost" size="icon-sm" aria-label={`Stage ${file.path}`} onClick={() => onStage([file.path])}>
                  <Plus className="size-3.5" />
                </Button>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The one layout every Git state renders: the Git header first, then the body for the current view. The Refresh button
 * is in the header only for the repository view.
 */
export function GitPanel({
  view,
  errorMessage,
  onRefresh,
  repoBody,
}: {
  view: GitView
  errorMessage?: string | null
  onRefresh: () => void
  repoBody?: ReactNode
}) {
  const actions =
    view === 'repo' ? (
      <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
        <RefreshCw className="size-4" />
      </Button>
    ) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SidePanelHeader title="Git" titleId="side-git-title" actions={actions} />
      <GitBody view={view} errorMessage={errorMessage ?? null} onRefresh={onRefresh} repoBody={repoBody ?? null} />
    </div>
  )
}

function GitBody({ view, errorMessage, onRefresh, repoBody }: { view: GitView; errorMessage: string | null; onRefresh: () => void; repoBody: ReactNode }) {
  if (view === 'no-chat') {
    return (
      <SidePanelEmptyState
        icon={MessageSquareText}
        title="No chat selected"
        description="Open a chat to see its repository and file changes here."
      />
    )
  }
  if (view === 'no-folder') {
    return (
      <SidePanelEmptyState
        icon={FolderGit2}
        title="No project folder"
        description="This chat has no project folder. The Git tab works once the chat has a folder inside a git repository."
      />
    )
  }
  if (view === 'error') {
    return (
      <SidePanelEmptyState
        icon={AlertTriangle}
        title="Could not read this repository"
        description={errorMessage ?? 'Git request failed'}
        action={{ label: 'Try again', onClick: onRefresh, icon: RefreshCw }}
      />
    )
  }
  if (view === 'loading') {
    return <p className="p-3 text-sm text-muted-foreground">Loading repository…</p>
  }
  if (view === 'not-repo') {
    return (
      <SidePanelEmptyState
        icon={GitBranch}
        title="Not a git repository"
        description="This folder is not a git repository. The Git tab works once this chat's folder is inside one."
      />
    )
  }
  return repoBody
}

/** The Staged section's body when nothing is staged: says where files come from, and nothing more. */
export function StagedEmptyState() {
  return (
    <div className="flex flex-col gap-0.5 py-1">
      <p className="text-sm font-medium">Nothing staged</p>
      <p className="text-xs text-muted-foreground">Stage files from Changes to commit them.</p>
    </div>
  )
}

export function GitSideTab(context: SideTabContext & { fetchers?: typeof gitApi }) {
  const api = context.fetchers ?? gitApi
  const { activeChat, openPanel, notify } = context
  const cwd = activeChat?.launchCwd ?? null
  const chatId = activeChat?.id ?? null
  const agentBusy = activeChat?.busy ?? false

  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [state, setState] = useState<GitState>({ status: { staged: [], unstaged: [] }, commits: [] })
  const [message, setMessage] = useState('')
  const [review, setReview] = useState<CommitReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)
  /** Bumped when the stored comments change, so the count reads them again. */
  const [commentsVersion, setCommentsVersion] = useState(0)
  const latestCwd = useRef<string | null>(cwd)
  const previousAgentBusy = useRef(agentBusy)
  /** The per-branch draft key for the repository shown, or null until its branch is known. */
  const draftStoreKey = repo !== null && repo.repo ? draftKey(repo.root, repo.branch) : null

  useEffect(() => {
    const previousCwd = latestCwd.current
    latestCwd.current = cwd
    setMessage((draft) => draftFor(previousCwd, cwd, draft))
    if (previousCwd !== cwd) {
      setReview(null)
    }
    if (cwd === null) {
      return undefined
    }
    let stale = false
    setRepo(null)
    setLoadError(null)
    readRepository(api, cwd).then(
      (result) => {
        if (!stale) {
          setRepo(result.repo)
          if (result.state !== null) {
            setState(result.state)
          }
        }
      },
      (error: unknown) => {
        if (!stale) {
          setLoadError(messageOf(error))
          notify(messageOf(error), 'error')
        }
      },
    )
    return () => {
      stale = true
    }
  }, [cwd])

  // The agent stopped working, so the Git state may have changed: reload once it goes idle. Not on mount.
  useEffect(() => {
    const wasBusy = previousAgentBusy.current
    previousAgentBusy.current = agentBusy
    if (shouldRefreshOnIdle(wasBusy, agentBusy) && repo !== null && repo.repo && cwd !== null) {
      void reloadSafely()
    }
  }, [agentBusy])

  useEffect(() => subscribeCommentsChanged(() => setCommentsVersion((version) => version + 1)), [])
  const comments = useMemo(() => (chatId === null ? [] : readComments(browserStorage(), chatId)), [chatId, commentsVersion])

  // Each branch keeps its own unsent commit message. Load it when the branch is known and the field is empty.
  useEffect(() => {
    if (draftStoreKey === null) {
      return undefined
    }
    const stored = readDraft(browserStorage(), draftStoreKey)
    setMessage((current) => (current === '' ? stored : current))
  }, [draftStoreKey])

  /** Sets the message and saves it as the draft of the branch shown. */
  function changeMessage(value: string): void {
    setMessage(value)
    if (draftStoreKey !== null) {
      writeDraft(browserStorage(), draftStoreKey, value)
    }
  }

  /** Reads the repository for a folder into the tab. Returns the fresh state, or null when nothing was applied. */
  async function reload(target: string): Promise<GitState | null> {
    const result = await readRepository(api, target)
    if (!isCurrentCwd(latestCwd.current, target)) {
      return null
    }
    setRepo(result.repo)
    setLoadError(null)
    if (result.state !== null) {
      setState(result.state)
    }
    return result.state
  }

  async function reloadSafely(): Promise<void> {
    if (cwd === null) {
      return
    }
    try {
      await reload(cwd)
    } catch (error) {
      setLoadError(messageOf(error))
      notify(messageOf(error), 'error')
    }
  }

  async function changeStaging(stage: boolean, paths: string[]): Promise<void> {
    if (cwd === null) {
      return
    }
    try {
      if (stage) {
        await api.stage(cwd, paths)
      } else {
        await api.unstage(cwd, paths)
      }
      await reload(cwd)
    } catch (error) {
      notify(messageOf(error), 'error')
    }
  }

  /** Reloads status and the log first, so the dialog lists what is staged now. The dialog opens only after that succeeds. */
  async function openCommitReview(): Promise<void> {
    if (cwd === null) {
      return
    }
    setBusy(true)
    try {
      const fresh = await reload(cwd)
      if (fresh === null) {
        return
      }
      setReview(commitReviewAfterReload(fresh.status.staged, message))
    } catch (error) {
      notify(messageOf(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Commits exactly the files the dialog showed. If the staged set changed since, the server refuses: the error is shown, the
   * Git state is read again, and the person reviews the new list with a second Commit press.
   */
  async function confirmCommit(): Promise<void> {
    const approved = review
    setReview(null)
    if (cwd === null || approved === null) {
      return
    }
    setBusy(true)
    try {
      const expectedPaths = approved.staged.map((file) => file.path)
      const result = await commitStaged(api, cwd, approved.message, expectedPaths)
      const commits = await api.log(cwd)
      if (draftStoreKey !== null) {
        writeDraft(browserStorage(), draftStoreKey, '')
      }
      if (isCurrentCwd(latestCwd.current, cwd)) {
        setMessage('')
        setState({ status: result.status, commits })
      }
      notify('Committed', 'success')
    } catch (error) {
      notify(messageOf(error), 'error')
      void reloadSafely()
    } finally {
      setBusy(false)
    }
  }

  /** Attaches the active chat's comments to its composer and reports the outcome. */
  async function attachAll(): Promise<void> {
    if (chatId === null) {
      return
    }
    setAttaching(true)
    try {
      const outcome = await runAttachComments({ chatId, comments, branch: repo !== null && repo.repo ? repo.branch : null })
      if (outcome.status === 'attached') {
        notify('Attached to the chat', 'success')
      } else {
        notify(outcome.message, 'error')
      }
    } catch (error) {
      notify(messageOf(error), 'error')
    } finally {
      setAttaching(false)
    }
  }

  function openFile(scope: Scope, path: string, sha?: string): void {
    if (cwd === null || chatId === null) {
      return
    }
    openDiffPanel(openPanel, writeOpen, { cwd, chatId, path, scope, sha, from: chatId })
  }

  const view = gitView({ hasChat: activeChat !== null, cwd, repo, loadError })
  const { staged, unstaged } = state.status
  const { conflicted, other: unstagedOther } = splitConflicts(unstaged)
  const hint = commitHint(staged.length, message)
  const repoBody = view === 'repo' && cwd !== null ? (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <BranchLine
        branch={repo !== null && repo.repo ? repo.branch : null}
        upstream={repo !== null && repo.repo ? repo.upstream : null}
        ahead={repo !== null && repo.repo ? repo.ahead : 0}
        behind={repo !== null && repo.repo ? repo.behind : 0}
      />
      <Accordion id="git.staged" title={`Staged changes · ${staged.length}`} aside={<SectionTotals files={staged} />} defaultOpen fill>
        <div className="flex h-full min-h-0 flex-col gap-3">
          {staged.length === 0 ? (
            <StagedEmptyState />
          ) : (
            <div className="min-h-0 flex-1">
              <StatusTree
                files={staged}
                mode="staged"
                onOpen={(file) => openFile('staged', file.path)}
                onStage={(paths) => void changeStaging(true, paths)}
                onUnstage={(paths) => void changeStaging(false, paths)}
              />
            </div>
          )}
          <div className="flex shrink-0 flex-col gap-2">
            <CommitTypeSelect message={message} onChange={changeMessage} />
            <Textarea aria-label="Commit message" placeholder="Commit message" value={message} onChange={(event) => changeMessage(event.target.value)} />
            <div className="flex flex-col items-end gap-1">
              <Button disabled={busy || !canCommit(staged, message)} onClick={() => void openCommitReview()}>
                Commit
              </Button>
              {hint === null ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
            </div>
          </div>
        </div>
      </Accordion>
      <Accordion id="git.changes" title={`Changes · ${unstaged.length}`} aside={<SectionTotals files={unstaged} />} defaultOpen fill>
        <div className="flex h-full min-h-0 flex-col gap-3">
          {conflicted.length === 0 ? null : (
            <ConflictGroup
              files={conflicted}
              onOpen={(file) => openFile('unstaged', file.path)}
              onStage={(paths) => void changeStaging(true, paths)}
            />
          )}
          <div className="min-h-0 flex-1">
            <StatusTree
              files={unstagedOther}
              mode="unstaged"
              onOpen={(file) => openFile('unstaged', file.path)}
              onStage={(paths) => void changeStaging(true, paths)}
              onUnstage={(paths) => void changeStaging(false, paths)}
            />
          </div>
        </div>
      </Accordion>
      <Accordion
        id="git.log"
        title="Git log"
        aside={<span className="font-mono text-xs text-muted-foreground">{state.commits.length}</span>}
        defaultOpen
        fill
      >
        <CommitLog key={cwd} commits={state.commits} cwd={cwd} onOpen={(file, sha) => openFile('commit', file.path, sha)} />
      </Accordion>
      <CommitDialog
        open={review !== null}
        message={review?.message ?? ''}
        staged={review?.staged ?? []}
        onCancel={() => setReview(null)}
        onConfirm={() => void confirmCommit()}
      />
      <div className="flex shrink-0 justify-center border-t border-border pt-2 md:hidden">
        <AttachCommentsControl count={comments.length} busy={attaching} onAttach={() => void attachAll()} />
      </div>
    </div>
  ) : null
  return <GitPanel view={view} errorMessage={loadError} onRefresh={() => void reloadSafely()} repoBody={repoBody} />
}
