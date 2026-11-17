import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FolderGit2, GitBranch, MessageSquareText, RefreshCw } from 'lucide-react'
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
import { SectionTotals, StatusTree } from './StatusTree.tsx'

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

/** Commits the staged changes once, then reads status back. Errors propagate and status is not read. */
export async function commitStaged(api: CommitApi, cwd: string, message: string): Promise<{ sha: string; status: GitState['status'] }> {
  const { sha } = await api.commit(cwd, message)
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

  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [state, setState] = useState<GitState>({ status: { staged: [], unstaged: [] }, commits: [] })
  const [message, setMessage] = useState('')
  const [review, setReview] = useState<CommitReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const latestCwd = useRef<string | null>(cwd)

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

  async function confirmCommit(): Promise<void> {
    const approved = review
    setReview(null)
    if (cwd === null || approved === null) {
      return
    }
    setBusy(true)
    try {
      const result = await commitStaged(api, cwd, approved.message)
      const commits = await api.log(cwd)
      if (isCurrentCwd(latestCwd.current, cwd)) {
        setMessage('')
        setState({ status: result.status, commits })
      }
      notify('Committed', 'success')
    } catch (error) {
      notify(messageOf(error), 'error')
    } finally {
      setBusy(false)
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
  const hint = commitHint(staged.length, message)
  const repoBody = view === 'repo' && cwd !== null ? (
    <div className="flex min-h-0 flex-1 flex-col p-3">
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
            <Textarea aria-label="Commit message" placeholder="Commit message" value={message} onChange={(event) => setMessage(event.target.value)} />
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
        <StatusTree
          files={unstaged}
          mode="unstaged"
          onOpen={(file) => openFile('unstaged', file.path)}
          onStage={(paths) => void changeStaging(true, paths)}
          onUnstage={(paths) => void changeStaging(false, paths)}
        />
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
    </div>
  ) : null
  return <GitPanel view={view} errorMessage={loadError} onRefresh={() => void reloadSafely()} repoBody={repoBody} />
}
