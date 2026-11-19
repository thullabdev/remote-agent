import { useEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { attachCommentToChat } from '../attach-comment.ts'
import { buttonPosition, quoteMarkdown, quoteTitle, type Rect, selectionQuote, type SelectedQuote } from '../quote.ts'
import { Button } from './ui/button.tsx'

/** The card around the quote editor: the composer's container. */
const CARD_CLASS =
  'flex min-w-0 max-w-full flex-col rounded-3xl bg-card shadow-[0_-4px_18px_-6px_rgb(0_0_0/.22),0_10px_28px_-12px_rgb(0_0_0/.35)]'

/** The editor's widest size, and the height it is placed by. The editor is clamped to the viewport. */
const EDITOR_WIDTH = 384
const EDITOR_HEIGHT = 230

/** A selection that can be quoted, with where it sits on screen. */
type Candidate = SelectedQuote & { rect: Rect }

/** The browser's viewport size, or a small default where there is no window. */
function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768 }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

/** A new bundle id: a UUID where the browser has one, otherwise a time and random string. */
function newBundleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Reads the document's current selection as a quote, when it is one inside `scope`. */
function currentCandidate(scope: HTMLElement | null): Candidate | null {
  if (typeof document === 'undefined' || scope === null) {
    return null
  }
  const selection = document.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.anchorNode === null || !scope.contains(selection.anchorNode)) {
    return null
  }
  const quote = selectionQuote(selection)
  if (quote === null) {
    return null
  }
  const box = selection.getRangeAt(0).getBoundingClientRect()
  return { ...quote, rect: { top: box.top, left: box.left, width: box.width, height: box.height } }
}

/**
 * Lets the user comment on a span of chat text. Selecting text inside a message or a tool block shows a Comment button near the
 * selection; pressing it opens a small editor for the quoted span, and saving adds a quote card to the chat's composer. It mounts once
 * in the message feed. `scope` is the feed: selections outside it are ignored.
 */
export function QuoteComment({ chatId, scope }: { chatId: string; scope: RefObject<HTMLElement | null> }) {
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [editing, setEditing] = useState<Candidate | null>(null)

  useEffect(() => {
    const read = () => {
      setCandidate(currentCandidate(scope.current))
    }
    document.addEventListener('selectionchange', read)
    window.addEventListener('scroll', read, true)
    window.addEventListener('resize', read)
    read()
    return () => {
      document.removeEventListener('selectionchange', read)
      window.removeEventListener('scroll', read, true)
      window.removeEventListener('resize', read)
    }
  }, [scope])

  // An open editor belongs to the chat it was started in.
  useEffect(() => {
    setEditing(null)
  }, [chatId])

  const save = (comment: string) => {
    if (editing === null) {
      return
    }
    attachCommentToChat({
      chatId,
      kind: 'quote',
      title: quoteTitle(editing.source),
      markdown: quoteMarkdown(editing.text, comment),
      count: 1,
      files: [],
    })
    setEditing(null)
    setCandidate(null)
    document.getSelection()?.removeAllRanges()
  }

  if (editing !== null) {
    const viewport = viewportSize()
    const width = Math.min(EDITOR_WIDTH, viewport.width - 16)
    const position = buttonPosition(editing.rect, viewport, { width, height: EDITOR_HEIGHT })
    return createPortal(
      <div className="fixed z-50" style={{ top: position.top, left: position.left, width }}>
        <QuoteEditor quote={editing.text} source={editing.source} onSave={save} onCancel={() => setEditing(null)} />
      </div>,
      document.body,
    )
  }

  if (candidate === null) {
    return null
  }
  const position = buttonPosition(candidate.rect, viewportSize())
  return createPortal(
    <div className="fixed z-50" style={{ top: position.top, left: position.left }}>
      <Button
        size="sm"
        className="rounded-full shadow-md"
        // Keeps the text selection while the button is pressed, so the click still has a selection to quote.
        onMouseDown={event => event.preventDefault()}
        onPointerDown={event => event.preventDefault()}
        onClick={() => setEditing(candidate)}
      >
        Comment
      </Button>
    </div>,
    document.body,
  )
}

/**
 * The editor for a quote: the quoted span (clipped to a few lines, scrollable), then a textarea with Cancel and a round Save. An empty
 * comment cannot be saved. Escape cancels.
 */
export function QuoteEditor({ quote, source, onSave, onCancel }: { quote: string; source: string; onSave(comment: string): void; onCancel(): void }) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  return (
    <div role="dialog" aria-label={`Comment on quote from ${source}`} className={`${CARD_CLASS} w-full`}>
      <div className="flex min-w-0 flex-col gap-1.5 px-4 pt-3 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{quoteTitle(source)}</span>
        <blockquote className="max-h-24 min-w-0 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-3 text-xs leading-relaxed text-muted-foreground">
          {quote}
        </blockquote>
      </div>
      <div className="flex min-w-0 items-end gap-2 pl-4 pr-1.5 py-1.5">
        <textarea
          aria-label="Comment text"
          placeholder="Comment on this quote"
          value={text}
          autoFocus
          rows={1}
          className="max-h-[140px] min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 font-sans text-[length:var(--message-font,1rem)] leading-relaxed break-words placeholder:text-muted-foreground focus:outline-none"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              onCancel()
            }
          }}
        />
        <Button variant="ghost" size="sm" className="mb-0.5 shrink-0" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="icon"
          aria-label="Save comment"
          title="Save comment"
          disabled={trimmed === ''}
          className="mb-0.5 size-9 shrink-0 rounded-full disabled:opacity-30"
          onClick={() => onSave(trimmed)}
        >
          <Check aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
