import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Commit, FileChange } from '../backend/parse.ts'
import type { RepoInfo } from '../backend/git.ts'
import type { OpenPanel, SideTabContext } from '../../../src/ui/extension-slots.ts'
import { Accordion } from '../../../src/ui/components/ui/accordion.tsx'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { Textarea } from '../../../src/ui/components/ui/textarea.tsx'
import type { OpenStateStorage } from '../../../src/ui/components/ui/accordion-state.ts'
import { gitApi } from './client.ts'
import { CommitDialog } from './CommitDialog.tsx'
import { CommitLog } from './CommitLog.tsx'
import { type OpenDiff, readOpenDiffs, writeOpenDiffs } from './open-files.ts'
import { StatusTree } from './StatusTree.tsx'

export type Scope = 'staged' | 'unstaged' | 'commit'
export type GitState = { status: { staged: FileChange[]; unstaged: FileChange[] }; commits: Commit[] }
export type DiffParams = { cwd: string; chatId: string; path: string; scope: Scope; sha?: string }
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
  openPanel('git.diff', panelParams)
  writeOpen(params.chatId, diff)
}

function browserStorage(): OpenStateStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Records a diff as open for a chat in the browser's storage. */
export function writeOpen(chatId: string, diff: OpenDiff): void {
  const storage = browserStorage()
  const kept = readOpenDiffs(storage, chatId).filter((open) => !(open.path === diff.path && open.scope === diff.scope && open.sha === diff.sha))
  writeOpenDiffs(storage, chatId, [...kept, diff])
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

export function GitHeader({ onRefresh }: { onRefresh(): void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-display text-base font-semibold">Git</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={onRefresh}>
        <RefreshCw className="size-4" />
      </Button>
    </div>
  )
}

export function NoRepositoryState() {
  return <p className="p-3 text-sm text-muted-foreground">{"No git repository in this chat's folder"}</p>
}

/** The tab's view when the repository could not be loaded: the header stays so the user can retry. */
export function RepoErrorState({ message, onRefresh }: { message: string; onRefresh(): void }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <GitHeader onRefresh={onRefresh} />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function NoChatState() {
  return <p className="p-3 text-sm text-muted-foreground">Open a chat to see its repository</p>
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
    openDiffPanel(openPanel, writeOpen, { cwd, chatId, path, scope, sha })
  }

  if (activeChat === null) {
    return <NoChatState />
  }
  if (cwd === null) {
    return <NoRepositoryState />
  }
  if (repo === null && loadError !== null) {
    return <RepoErrorState message={loadError} onRefresh={() => void reloadSafely()} />
  }
  if (repo === null) {
    return <p className="p-3 text-sm text-muted-foreground">Loading repository…</p>
  }
  if (!repo.repo) {
    return <NoRepositoryState />
  }

  const { staged, unstaged } = state.status
  return (
    <div className="flex flex-col gap-3 p-3">
      <GitHeader onRefresh={() => void reloadSafely()} />
      <Accordion id="git.staged" title={`Staged changes · ${staged.length}`} defaultOpen>
        <div className="flex flex-col gap-3">
          <StatusTree
            files={staged}
            mode="staged"
            onOpen={(file) => openFile('staged', file.path)}
            onStage={(paths) => void changeStaging(true, paths)}
            onUnstage={(paths) => void changeStaging(false, paths)}
          />
          <div className="flex flex-col gap-2">
            <Textarea aria-label="Commit message" placeholder="Commit message" value={message} onChange={(event) => setMessage(event.target.value)} />
            <Button className="self-end" disabled={busy || !canCommit(staged, message)} onClick={() => void openCommitReview()}>
              Commit
            </Button>
          </div>
        </div>
      </Accordion>
      <Accordion id="git.changes" title={`Changes · ${unstaged.length}`} defaultOpen>
        <StatusTree
          files={unstaged}
          mode="unstaged"
          onOpen={(file) => openFile('unstaged', file.path)}
          onStage={(paths) => void changeStaging(true, paths)}
          onUnstage={(paths) => void changeStaging(false, paths)}
        />
      </Accordion>
      <Accordion id="git.log" title="Git log" defaultOpen>
        <CommitLog commits={state.commits} cwd={cwd} onOpen={(file, sha) => openFile('commit', file.path, sha)} />
      </Accordion>
      <CommitDialog
        open={review !== null}
        message={review?.message ?? ''}
        staged={review?.staged ?? []}
        onCancel={() => setReview(null)}
        onConfirm={() => void confirmCommit()}
      />
    </div>
  )
}
