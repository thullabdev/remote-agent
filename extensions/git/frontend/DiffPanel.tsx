import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { DiffHunk, DiffLine } from '../backend/parse.ts'
import type { PanelContext } from '../../../src/ui/extension-slots.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { cn } from '../../../src/ui/lib/utils.ts'
import { gitApi } from './client.ts'
import { closeOptionsFor, removeTab, sameDiff, tabName } from './diff-tabs.ts'
import { escapeHtml, highlightLine, languageOf } from './highlight.ts'
import { browserStorage, type OpenDiff, readOpenDiffs, writeOpenDiffs } from './open-files.ts'

/** Diffs longer than this render the first lines until the person asks for all of them. */
export const DIFF_LINE_LIMIT = 2000

export type Scope = 'staged' | 'unstaged' | 'commit'
export type DiffResult = { binary: boolean; hunks: DiffHunk[] }
export type FetchDiff = (cwd: string, path: string, scope: Scope, sha?: string) => Promise<DiffResult>
export type DiffRequest = { cwd: string; path: string; scope: Scope; sha?: string }

export type DiffPanelProps = PanelContext & { fetchDiff?: FetchDiff }

export type LoadState = { status: 'loading' } | { status: 'ready'; diff: DiffResult } | { status: 'error'; message: string }

const LINE_CLASS: Record<DiffLine['kind'], string> = {
  added: 'bg-emerald-500/10',
  removed: 'bg-red-500/10',
  context: '',
  meta: 'text-muted-foreground',
}

/** Calls the diff fetcher with the request's fields and returns its result. Errors propagate to the caller. */
export async function loadDiff(fetchDiff: FetchDiff, request: DiffRequest): Promise<DiffResult> {
  return fetchDiff(request.cwd, request.path, request.scope, request.sha)
}

/** The hunks to show: all of them when `showAll`, otherwise the first `DIFF_LINE_LIMIT` lines across hunks. */
export function visibleHunks(hunks: DiffHunk[], showAll: boolean): DiffHunk[] {
  if (showAll) {
    return hunks
  }
  const result: DiffHunk[] = []
  let remaining = DIFF_LINE_LIMIT
  for (const hunk of hunks) {
    if (remaining <= 0) {
      break
    }
    const lines = hunk.lines.slice(0, remaining)
    remaining -= lines.length
    result.push({ header: hunk.header, lines })
  }
  return result
}

export function countLines(hunks: DiffHunk[], kind: DiffLine['kind']): number {
  let count = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === kind) {
        count += 1
      }
    }
  }
  return count
}

function totalLines(hunks: DiffHunk[]): number {
  return hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
}

/** The footer's scope label: the scope name, or the short commit sha for a commit's diff. */
export function scopeLabel(scope: Scope, sha?: string): string {
  if (scope === 'commit' && sha !== undefined && sha !== '') {
    return sha.slice(0, 7)
  }
  return scope
}

/** The params that open the diff panel on one open diff, keeping the chat it belongs to and where it was opened from. */
export function panelParamsFor(diff: OpenDiff, base: { cwd: string; chatId: string; from?: string }): Record<string, string> {
  const params: Record<string, string> = { cwd: base.cwd, chatId: base.chatId, path: diff.path, scope: diff.scope }
  if (diff.sha !== undefined) {
    params.sha = diff.sha
  }
  if (base.from !== undefined && base.from !== '') {
    params.from = base.from
  }
  return params
}

function tabKey(diff: OpenDiff): string {
  return `${diff.scope}:${diff.sha ?? ''}:${diff.path}`
}

export type DiffViewProps = {
  path: string
  scope: Scope
  sha?: string
  added: number
  removed: number
  binary: boolean
  /** The full diff. `showAll` decides how much of it is rendered. */
  hunks: DiffHunk[]
  showAll: boolean
  /** Highlighted inline HTML per visible hunk and line. Null or missing entries fall back to escaped text. */
  highlighted?: string[][] | null
  status?: 'loading' | 'ready' | 'error'
  error?: string
  /** The chat's open diffs, shown as tabs in order. The shown diff is added as a tab when it is not in the list. */
  tabs?: OpenDiff[]
  onSelectTab?: (diff: OpenDiff) => void
  onCloseTab?: (diff: OpenDiff) => void
  onShowAll: () => void
  /** Closes the panel. Sits at the right of the tab strip. */
  onClose: () => void
}

/** The diff panel's markup. Stateless, so it renders the same under renderToStaticMarkup. */
export function DiffView(props: DiffViewProps) {
  const {
    path,
    scope,
    sha,
    added,
    removed,
    binary,
    hunks,
    showAll,
    highlighted = null,
    status = 'ready',
    error,
    tabs = [],
    onSelectTab,
    onCloseTab,
    onShowAll,
    onClose,
  } = props
  const shown = visibleHunks(hunks, showAll)
  const truncated = status === 'ready' && !binary && !showAll && totalLines(hunks) > DIFF_LINE_LIMIT
  const active: OpenDiff = sha === undefined ? { path, scope } : { path, scope, sha }
  const strip = tabs.some(tab => sameDiff(tab, active)) ? tabs : [...tabs, active]

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex min-w-0 items-center gap-2 border-b border-border px-2 py-1">
        <div role="tablist" aria-label="Open diffs" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {strip.map(tab => {
            const isActive = sameDiff(tab, active)
            const name = tabName(tab.path)
            return (
              <div
                key={tabKey(tab)}
                className={cn('flex shrink-0 items-center rounded-md text-sm', isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60')}
              >
                <button type="button" role="tab" aria-selected={isActive} className="px-2 py-1" onClick={() => onSelectTab?.(tab)}>
                  {name}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${name}`}
                  className="mr-1 rounded-sm p-0.5 hover:bg-background"
                  onClick={() => onCloseTab?.(tab)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close diff" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {status === 'loading' ? <p className="p-4 text-sm text-muted-foreground">Loading diff…</p> : null}
        {status === 'error' ? (
          <p role="alert" className="p-4 text-sm text-red-600 dark:text-red-400">
            {error ?? 'Could not load the diff'}
          </p>
        ) : null}
        {status === 'ready' && binary ? <p className="p-4 text-sm text-muted-foreground">Binary file: no text diff</p> : null}

        {status === 'ready' && !binary
          ? shown.map((hunk, hunkIndex) => (
              <pre key={hunkIndex} className="git-diff-code w-max min-w-full py-2 font-mono text-xs leading-5">
                <span className="block px-3 text-muted-foreground">{hunk.header}</span>
                {hunk.lines.map((diffLine, lineIndex) => {
                  const markup = highlighted?.[hunkIndex]?.[lineIndex] ?? escapeHtml(diffLine.text)
                  return (
                    <span key={lineIndex} data-diff-line className={cn('flex', LINE_CLASS[diffLine.kind])}>
                      <span className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground">{diffLine.oldLine ?? ''}</span>
                      <span className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground">{diffLine.newLine ?? ''}</span>
                      <span className="whitespace-pre pr-3" dangerouslySetInnerHTML={{ __html: markup }} />
                    </span>
                  )
                })}
              </pre>
            ))
          : null}

        {truncated ? (
          <div className="flex items-center gap-3 p-3 text-xs text-muted-foreground">
            <span>{`Showing the first ${DIFF_LINE_LIMIT.toLocaleString('en-US')} lines.`}</span>
            <Button variant="outline" size="sm" onClick={onShowAll}>
              Show all
            </Button>
          </div>
        ) : null}
      </div>

      <footer className="flex min-w-0 items-center gap-3 border-t border-border px-4 py-2">
        <p className="min-w-0 flex-1 truncate break-all font-mono text-xs text-muted-foreground">{path}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{scopeLabel(scope, sha)}</span>
        {status === 'ready' && !binary ? (
          <span className="shrink-0 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">{`+${added}`}</span>{' '}
            <span className="text-red-600 dark:text-red-400">{`−${removed}`}</span>
          </span>
        ) : null}
      </footer>
    </section>
  )
}

export function DiffPanel(props: DiffPanelProps) {
  const { params, openPanel, closePanel, fetchDiff = gitApi.diff } = props
  const cwd = params.cwd ?? ''
  const chatId = params.chatId ?? ''
  const path = params.path ?? ''
  const scope = params.scope as Scope
  const sha = params.sha
  const from = params.from
  const current: OpenDiff = sha === undefined ? { path, scope } : { path, scope, sha }

  // The tabs are the chat's open diffs. They are re-read whenever the shown diff changes, since opening a file writes the list.
  const [tabs, setTabs] = useState<OpenDiff[]>(() => readOpenDiffs(browserStorage(), chatId))
  useEffect(() => {
    setTabs(readOpenDiffs(browserStorage(), chatId))
  }, [chatId, path, scope, sha])

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [showAll, setShowAll] = useState(false)
  const [highlight, setHighlight] = useState<{ owner: DiffHunk[]; lines: string[][] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    setShowAll(false)
    loadDiff(fetchDiff, { cwd, path, scope, sha }).then(
      diff => {
        if (!cancelled) {
          setState({ status: 'ready', diff })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not load the diff' })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [fetchDiff, cwd, path, scope, sha])

  const diff = state.status === 'ready' ? state.diff : null
  const hunks = useMemo(() => (diff === null ? [] : diff.hunks), [diff])
  const shown = useMemo(() => visibleHunks(hunks, showAll), [hunks, showAll])

  const language = languageOf(path)
  useEffect(() => {
    let cancelled = false
    void Promise.all(shown.map(hunk => Promise.all(hunk.lines.map(line => highlightLine(line.text, language))))).then(lines => {
      if (!cancelled) {
        setHighlight({ owner: shown, lines })
      }
    })
    return () => {
      cancelled = true
    }
  }, [shown, language])

  return (
    <DiffView
      path={path}
      scope={scope}
      sha={sha}
      added={countLines(hunks, 'added')}
      removed={countLines(hunks, 'removed')}
      binary={diff?.binary ?? false}
      hunks={hunks}
      showAll={showAll}
      highlighted={highlight !== null && highlight.owner === shown ? highlight.lines : null}
      status={state.status}
      error={state.status === 'error' ? state.message : undefined}
      tabs={tabs}
      onSelectTab={diff => openPanel('git.diff', panelParamsFor(diff, { cwd, chatId, from }))}
      onCloseTab={diff => closeTab(diff)}
      onShowAll={() => setShowAll(true)}
      onClose={() => closePanel(closeOptionsFor(from))}
    />
  )

  /** Removes a tab. Closing the shown tab moves to the nearest remaining one; closing the last tab returns to the origin chat. */
  function closeTab(diff: OpenDiff): void {
    const storage = browserStorage()
    const removed = removeTab(readOpenDiffs(storage, chatId), diff)
    writeOpenDiffs(storage, chatId, removed.list)
    setTabs(removed.list)
    if (removed.list.length === 0) {
      closePanel(closeOptionsFor(from))
      return
    }
    if (sameDiff(diff, current) && removed.next !== null) {
      openPanel('git.diff', panelParamsFor(removed.next, { cwd, chatId, from }))
    }
  }
}
