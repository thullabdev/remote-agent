import { Fragment, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { DiffHunk, DiffLine } from '../backend/parse.ts'
import { TabItem, TabStrip } from '../../../src/ui/components/tabs/tab-strip.tsx'
import type { PanelContext } from '../../../src/ui/extension-slots.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { cn } from '../../../src/ui/lib/utils.ts'
import { gitApi } from './client.ts'
import { closeOptionsFor, removeTab, sameDiff, tabName } from './diff-tabs.ts'
import { escapeHtml, highlightLine, languageOf } from './highlight.ts'
import { browserStorage, type OpenDiff, readOpenDiffs, writeOpenDiffs } from './open-files.ts'
import {
  addComment,
  announceCommentsChanged,
  anchorForLine,
  anchorForRange,
  type Comment,
  commentsForRow,
  createCommentId,
  readComments,
  removeComment,
  subscribeCommentsChanged,
} from './comments.ts'
import {
  AttachCommentsControl,
  CommentEditor,
  CommentGutterButton,
  CommentList,
  runAttachComments,
  SelectionCommentBar,
} from './CommentEditor.tsx'

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

/**
 * A comment selection within one hunk. `anchor` is the row where the selection started and `target` the row it was last extended
 * to, both row indices into the hunk's lines. They may be in either order.
 */
export type CommentSelection = { hunk: number; anchor: number; target: number }

/** The first and last row of a selection, inclusive, in display order. */
export function selectionBounds(selection: CommentSelection): { from: number; to: number } {
  return { from: Math.min(selection.anchor, selection.target), to: Math.max(selection.anchor, selection.target) }
}

/**
 * The selection after a click on a row's comment button. Shift extends the current selection to this row when both are in the
 * same hunk. Otherwise the row starts a new single-row selection.
 */
export function nextSelection(current: CommentSelection | null, hunk: number, row: number, shiftKey: boolean): CommentSelection {
  if (shiftKey && current !== null && current.hunk === hunk) {
    return { hunk, anchor: current.anchor, target: row }
  }
  return { hunk, anchor: row, target: row }
}

/** A diff row by its hunk and its index in the hunk, as the row's `data-hunk` and `data-row` attributes give them. */
export type RowRef = { hunk: number; row: number }

/**
 * The selection for a text selection that starts on `anchor` and ends on `focus`. Rows in the same hunk give the range between them.
 * When `focus` is in another hunk, the range stays in the anchor's hunk: it ends at the hunk's first row when the focus is above it,
 * or at `lastRow`, the hunk's last row, when the focus is below.
 */
export function selectionFromRows(anchor: RowRef, focus: RowRef, lastRow: number): CommentSelection {
  if (focus.hunk === anchor.hunk) {
    return { hunk: anchor.hunk, anchor: anchor.row, target: focus.row }
  }
  const target = focus.hunk < anchor.hunk ? 0 : lastRow
  return { hunk: anchor.hunk, anchor: anchor.row, target }
}

export function sameSelection(a: CommentSelection, b: CommentSelection): boolean {
  return a.hunk === b.hunk && a.anchor === b.anchor && a.target === b.target
}

/**
 * The comment range shown in the diff. `fromText` is true while the range came from a text selection and the editor is not yet
 * open. Such a range is cleared when the text selection goes away. A range from a gutter button, or one the Comment button opened,
 * is kept.
 */
export type CommentRange = { selection: CommentSelection; fromText: boolean }

/** The range after the document selection changed. `mapped` is the selection's rows, or null when it is collapsed or not on the diff's rows. */
export function rangeAfterTextSelection(current: CommentRange | null, mapped: CommentSelection | null): CommentRange | null {
  if (mapped === null) {
    if (current !== null && current.fromText) {
      return null
    }
    return current
  }
  if (current !== null && sameSelection(current.selection, mapped)) {
    return current
  }
  return { selection: mapped, fromText: true }
}

/** The row a DOM node is in, when the node is inside the container's row elements. */
export function rowRefOf(node: Node | null, container: Element): RowRef | null {
  if (node === null || !container.contains(node)) {
    return null
  }
  const element = node instanceof Element ? node : node.parentElement
  const rowElement = element?.closest('[data-row]') ?? null
  const hunkElement = rowElement?.closest('[data-hunk]') ?? null
  if (rowElement === null || hunkElement === null || !container.contains(rowElement)) {
    return null
  }
  const row = Number(rowElement.getAttribute('data-row'))
  const hunk = Number(hunkElement.getAttribute('data-hunk'))
  if (!Number.isInteger(row) || !Number.isInteger(hunk)) {
    return null
  }
  return { hunk, row }
}

/**
 * The range for the document's selection, or null when it is collapsed or either end is outside the container's rows. `hunks` are the
 * visible hunks, which give the last row of the anchor's hunk.
 */
export function selectionFromDocument(selection: Selection, container: Element, hunks: DiffHunk[]): CommentSelection | null {
  if (selection.isCollapsed) {
    return null
  }
  const anchor = rowRefOf(selection.anchorNode, container)
  const focus = rowRefOf(selection.focusNode, container)
  if (anchor === null || focus === null) {
    return null
  }
  const hunk = hunks[anchor.hunk]
  if (hunk === undefined) {
    return null
  }
  return selectionFromRows(anchor, focus, hunk.lines.length - 1)
}

/** The bar's label for a range: its line numbers, or a note when no row has a number. */
export function selectionLabel(rows: DiffLine[]): string {
  const anchor = anchorForRange(rows)
  if (anchor === null) {
    return 'No commentable lines selected'
  }
  if (anchor.endLine !== undefined && anchor.endLine !== anchor.line) {
    return `Lines ${anchor.line}–${anchor.endLine} selected`
  }
  return `Line ${anchor.line} selected`
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
  /** The chat's comments. Each line shows the ones anchored to it. */
  comments?: Comment[]
  /** The rows being commented on, if any. The editor opens under the selection's last row. */
  selection?: CommentSelection | null
  /** True while the selection came from the text and the editor is not open. The bar offers the Comment button instead of the editor. */
  selectionPending?: boolean
  /** The Comment button on the bar: opens the editor under the selection's last row. */
  onCommentSelection?: () => void
  /** The scroll container of the code. The panel reads the text selection inside it. */
  scrollRef?: RefObject<HTMLDivElement | null>
  /** Selects a row for a comment: a plain click starts a new selection, Shift extends it. Only given where comments can be made. */
  onSelectRow?: (hunk: number, row: number, shiftKey: boolean) => void
  onSaveComment?: (text: string) => void
  onCancelComment?: () => void
  onRemoveComment?: (id: string) => void
  /** The footer's comment count and Attach to chat control. The control is shown when `onAttachComments` is given. */
  commentCount?: number
  attaching?: boolean
  onAttachComments?: () => void
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
    comments = [],
    selection = null,
    selectionPending = false,
    onCommentSelection,
    scrollRef,
    onSelectRow,
    onSaveComment,
    onCancelComment,
    onRemoveComment,
    commentCount = 0,
    attaching = false,
    onAttachComments,
  } = props
  const shown = visibleHunks(hunks, showAll)
  const truncated = status === 'ready' && !binary && !showAll && totalLines(hunks) > DIFF_LINE_LIMIT
  const active: OpenDiff = sha === undefined ? { path, scope } : { path, scope, sha }
  const strip = tabs.some(tab => sameDiff(tab, active)) ? tabs : [...tabs, active]
  const selectedRows = selection === null ? [] : (shown[selection.hunk]?.lines.slice(selectionBounds(selection).from, selectionBounds(selection).to + 1) ?? [])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-10 min-w-0 shrink-0 items-stretch gap-2 px-2">
        <div className="flex min-h-0 min-w-0 flex-1">
          <TabStrip label="Open diffs">
            {strip.map(tab => {
              const isActive = sameDiff(tab, active)
              const name = tabName(tab.path)
              return (
                <TabItem
                  key={tabKey(tab)}
                  name={name}
                  title={name}
                  selected={isActive}
                  closeLabel={`Close ${name}`}
                  onSelect={() => onSelectTab?.(tab)}
                  onClose={() => onCloseTab?.(tab)}
                />
              )
            })}
          </TabStrip>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close diff" onClick={onClose}>
          <X />
        </Button>
      </header>

      {/* The container is an inline-size query container, so the comment blocks can size to the visible width of the diff. */}
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto [container-type:inline-size]">
        {status === 'ready' && !binary && selection !== null && selectionPending ? (
          <SelectionCommentBar label={selectionLabel(selectedRows)} disabled={anchorForRange(selectedRows) === null} onComment={() => onCommentSelection?.()} />
        ) : null}
        {status === 'loading' ? <p className="p-4 text-sm text-muted-foreground">Loading diff…</p> : null}
        {status === 'error' ? (
          <p role="alert" className="p-4 text-sm text-red-600 dark:text-red-400">
            {error ?? 'Could not load the diff'}
          </p>
        ) : null}
        {status === 'ready' && binary ? <p className="p-4 text-sm text-muted-foreground">Binary file: no text diff</p> : null}

        {status === 'ready' && !binary ? (
          // One width for every hunk, as an editor does: the widest line sets it, and the diff scrolls sideways as a whole.
          <div className="w-max min-w-full">
          {shown.map((hunk, hunkIndex) => {
              const bounds = selection !== null && selection.hunk === hunkIndex ? selectionBounds(selection) : null
              return (
                <pre key={hunkIndex} className="git-diff-code block py-2 font-mono text-xs leading-5">
                  <span className="block px-3 text-muted-foreground">{hunk.header}</span>
                  {hunk.lines.map((diffLine, lineIndex) => {
                    const markup = highlighted?.[hunkIndex]?.[lineIndex] ?? escapeHtml(diffLine.text)
                    const anchor = anchorForLine(diffLine)
                    const lineComments = anchor === null ? [] : commentsForRow(comments, path, scope, sha, anchor)
                    const selected = bounds !== null && lineIndex >= bounds.from && lineIndex <= bounds.to
                    const editorHere = bounds !== null && lineIndex === bounds.to
                    return (
                      <Fragment key={lineIndex}>
                        <span data-diff-line data-hunk={hunkIndex} data-row={lineIndex} className={cn('flex', selected ? 'bg-muted' : LINE_CLASS[diffLine.kind])}>
                          {anchor === null || onSelectRow === undefined ? (
                            <span className="w-5 shrink-0" />
                          ) : (
                            <CommentGutterButton line={anchor.line} onClick={(shiftKey) => onSelectRow(hunkIndex, lineIndex, shiftKey)} />
                          )}
                          <span className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground">{diffLine.oldLine ?? ''}</span>
                          <span className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground">{diffLine.newLine ?? ''}</span>
                          <span className="whitespace-pre pr-3" dangerouslySetInnerHTML={{ __html: markup }} />
                        </span>
                        {editorHere && !selectionPending ? <CommentEditor onSave={(text) => onSaveComment?.(text)} onCancel={() => onCancelComment?.()} /> : null}
                        {lineComments.length === 0 ? null : <CommentList comments={lineComments} onRemove={(id) => onRemoveComment?.(id)} />}
                      </Fragment>
                    )
                  })}
                </pre>
              )
            })}
          </div>
        ) : null}

        {truncated ? (
          <div className="flex items-center gap-3 p-3 text-xs text-muted-foreground">
            <span>{`Showing the first ${DIFF_LINE_LIMIT.toLocaleString('en-US')} lines.`}</span>
            <Button variant="outline" size="sm" onClick={onShowAll}>
              Show all
            </Button>
          </div>
        ) : null}
      </div>

      <footer className="flex min-w-0 flex-wrap items-center gap-3 border-t border-border px-4 py-2">
        <p className="min-w-0 flex-1 truncate break-all font-mono text-xs text-muted-foreground">{path}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{scopeLabel(scope, sha)}</span>
        {status === 'ready' && !binary ? (
          <span className="shrink-0 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">{`+${added}`}</span>{' '}
            <span className="text-red-600 dark:text-red-400">{`−${removed}`}</span>
          </span>
        ) : null}
        {onAttachComments === undefined ? null : (
          <div className="flex basis-full justify-center">
            <AttachCommentsControl count={commentCount} busy={attaching} onAttach={onAttachComments} />
          </div>
        )}
      </footer>
    </section>
  )
}

export function DiffPanel(props: DiffPanelProps) {
  const { params, openPanel, closePanel, notify, fetchDiff = gitApi.diff } = props
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

  // The chat's comments. They are re-read when the shown diff changes, and when any view of them changes.
  const [comments, setComments] = useState<Comment[]>(() => readComments(browserStorage(), chatId))
  const [range, setRange] = useState<CommentRange | null>(null)
  const selection = range?.selection ?? null
  const [attaching, setAttaching] = useState(false)
  useEffect(() => {
    setComments(readComments(browserStorage(), chatId))
    setRange(null)
  }, [chatId, path, scope, sha])
  useEffect(() => subscribeCommentsChanged(() => setComments(readComments(browserStorage(), chatId))), [chatId])

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

  // A text selection on the diff's rows sets the comment range. The listener is on while the diff is mounted. A selection that is
  // collapsed or leaves the rows clears only a range that came from the text.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onSelectionChange = () => {
      const container = scrollRef.current
      const docSelection = document.getSelection()
      const mapped = container === null || docSelection === null ? null : selectionFromDocument(docSelection, container, shown)
      setRange((current) => rangeAfterTextSelection(current, mapped))
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [shown])

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
      comments={comments}
      selection={selection}
      selectionPending={range?.fromText ?? false}
      onCommentSelection={() => setRange((current) => (current === null ? null : { selection: current.selection, fromText: false }))}
      scrollRef={scrollRef}
      onSelectRow={(hunk, row, shiftKey) => setRange({ selection: nextSelection(selection, hunk, row, shiftKey), fromText: false })}
      onSaveComment={(text) => saveComment(text)}
      onCancelComment={() => setRange(null)}
      onRemoveComment={(id) => setComments(removeComment(browserStorage(), chatId, id))}
      commentCount={comments.length}
      attaching={attaching}
      onAttachComments={() => void attachAll()}
    />
  )

  /** Saves the editor's text as a comment on the selected rows. Empty text is not saved. */
  function saveComment(text: string): void {
    const trimmed = text.trim()
    if (selection === null || trimmed === '') {
      return
    }
    const hunk = hunks[selection.hunk]
    if (hunk === undefined) {
      return
    }
    const { from, to } = selectionBounds(selection)
    const anchor = anchorForRange(hunk.lines.slice(from, to + 1))
    if (anchor === null) {
      return
    }
    const comment: Comment = {
      id: createCommentId(),
      path,
      scope,
      side: anchor.side,
      line: anchor.line,
      ...(anchor.endLine === undefined || anchor.quote === undefined ? {} : { endLine: anchor.endLine, quote: anchor.quote }),
      lineText: anchor.lineText,
      text: trimmed,
      createdAt: Date.now(),
      ...(scope === 'commit' && sha !== undefined ? { sha } : {}),
    }
    setComments(addComment(browserStorage(), chatId, comment))
    setRange(null)
    announceCommentsChanged()
  }

  /** Attaches the chat's comments to its composer. The comments clear only when the attach succeeds. */
  async function attachAll(): Promise<void> {
    setAttaching(true)
    try {
      const info = await gitApi.repo(cwd)
      const outcome = await runAttachComments({ chatId, comments, branch: info.repo ? info.branch : null })
      if (outcome.status === 'attached') {
        setComments([])
        notify('Attached to the chat', 'success')
      } else {
        notify(outcome.message, 'error')
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not attach the comments', 'error')
    } finally {
      setAttaching(false)
    }
  }

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
