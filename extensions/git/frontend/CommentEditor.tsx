import { useState } from 'react'
import { Check, MessageSquarePlus, X } from 'lucide-react'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { attachToComposer, openChatForAttach } from '../../../src/ui/composer-bus.ts'
import { attachComments, type AttachOutcome, type Comment, clearComments, announceCommentsChanged } from './comments.ts'
import { uploadTextAttachment } from './client.ts'
import { browserStorage } from './open-files.ts'

/**
 * The block under a diff line. On phones it spans the diff's visible width with a margin. `cqi` is the diff's scroll container, not the
 * code: the code's <pre> is as wide as its longest line, so a percentage of it would overflow the phone. From md up the block is
 * indented past the gutter so it lines up with the code.
 */
export const COMMENT_BLOCK_CLASS =
  'sticky left-0 mx-3 my-2 box-border block w-[calc(100cqi_-_1.5rem)] max-w-[calc(100cqi_-_1.5rem)] whitespace-normal font-sans text-sm md:mx-0 md:my-1.5 md:w-[40rem] md:max-w-full md:pl-[7.25rem] md:pr-3'

/** The card around an editor or a saved comment: the chat composer's container. */
const CARD_CLASS =
  'flex min-w-0 max-w-full flex-col rounded-3xl bg-card shadow-[0_-4px_18px_-6px_rgb(0_0_0/.22),0_10px_28px_-12px_rgb(0_0_0/.35)]'

/** The gutter button that selects a diff row for a comment. `onClick` gets whether Shift was held, which extends the selection. */
export function CommentGutterButton({ line, onClick }: { line: number; onClick(shiftKey: boolean): void }) {
  return (
    <button
      type="button"
      aria-label={`Comment on line ${line}`}
      title="Comment on this line"
      className="mr-1 flex w-4 shrink-0 select-none items-center justify-center rounded-sm text-muted-foreground opacity-40 hover:bg-muted hover:text-foreground hover:opacity-100"
      onClick={(event) => onClick(event.shiftKey)}
    >
      <MessageSquarePlus className="size-3" />
    </button>
  )
}

/**
 * The sticky bar at the top of the diff while a range is selected in the text. Its mousedown is prevented so the Comment click does
 * not clear the text selection before the click lands.
 */
export function SelectionCommentBar({ label, disabled, onComment }: { label: string; disabled: boolean; onComment(): void }) {
  return (
    <span
      className="sticky top-0 left-0 z-10 flex w-full min-w-0 justify-center bg-background px-3 py-2"
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="flex max-w-full min-w-0 items-center gap-2 rounded-full bg-card py-1 pl-3 pr-1 text-xs">
        <span className="min-w-0 truncate">{label}</span>
        <Button size="sm" className="h-7 shrink-0 rounded-full px-3" disabled={disabled} onClick={onComment}>
          Comment
        </Button>
      </span>
    </span>
  )
}

/** The inline editor under the last row of a comment selection. Empty text cannot be saved. Escape cancels. */
export function CommentEditor({ onSave, onCancel }: { onSave(text: string): void; onCancel(): void }) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  return (
    <span className={COMMENT_BLOCK_CLASS}>
      <span className={CARD_CLASS}>
        <span className="flex min-w-0 items-end gap-2 pl-4 pr-1.5 py-1.5">
          <textarea
            aria-label="Comment text"
            placeholder="Comment on this line"
            value={text}
            autoFocus
            rows={1}
            className="max-h-[140px] min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 font-sans text-[length:var(--message-font,1rem)] leading-relaxed break-words placeholder:text-muted-foreground focus:outline-none"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
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
        </span>
      </span>
    </span>
  )
}

/** The saved comments of one line, each in a card with a remove button. */
export function CommentList({ comments, onRemove }: { comments: Comment[]; onRemove(id: string): void }) {
  return (
    <>
      {comments.map((comment) => (
        <span key={comment.id} className={COMMENT_BLOCK_CLASS}>
          <span className={CARD_CLASS}>
            <span className="flex min-w-0 items-start gap-2 pl-4 pr-1.5 py-1.5">
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words py-1 leading-relaxed">{comment.text}</span>
              <Button variant="ghost" size="icon-sm" className="mt-0.5 shrink-0 rounded-full" aria-label="Remove comment" onClick={() => onRemove(comment.id)}>
                <X />
              </Button>
            </span>
          </span>
        </span>
      ))}
    </>
  )
}

/** The footer control: the comment count and the Attach to chat button. */
export function AttachCommentsControl({ count, busy, onAttach }: { count: number; busy: boolean; onAttach(): void }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      <span>{count === 1 ? '1 comment' : `${count} comments`}</span>
      {count === 0 ? <span>Comment on a line first</span> : null}
      <Button variant="outline" size="sm" disabled={count === 0 || busy} onClick={onAttach}>
        Attach to chat
      </Button>
    </span>
  )
}

/**
 * Attaches a chat's comments to its composer. On success the chat's stored comments are cleared and other views are told.
 * Any other outcome keeps the comments; the caller shows the message.
 */
export async function runAttachComments(input: { chatId: string; comments: Comment[]; branch: string | null }): Promise<AttachOutcome> {
  const outcome = await attachComments({
    chatId: input.chatId,
    comments: input.comments,
    branch: input.branch,
    now: new Date(),
    upload: uploadTextAttachment,
    attach: attachToComposer,
    open: openChatForAttach,
  })
  if (outcome.status === 'attached') {
    clearComments(browserStorage(), input.chatId)
    announceCommentsChanged()
  }
  return outcome
}
