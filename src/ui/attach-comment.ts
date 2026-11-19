import { type CommentBundle, type CommentBundleKind } from './comment-bundle.ts'
import { attachCommentsToComposer, openChatForAttach, type AttachResult } from './composer-bus.ts'

/** What a caller attaches to a chat: a card's content. The host adds the id and the time. */
export type CommentToAttach = {
  chatId: string
  kind: CommentBundleKind
  /** The label the composer card shows, for example "Review comments · 3 comments" or "Quote · Bash result". */
  title: string
  /** Prepended to the next message's text when the chat is sent. */
  markdown: string
  count: number
  files: string[]
}

/** A new id for a card. Uses the platform's UUID when it exists. */
export function newCommentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The one way to attach a comment or a quote to a chat, for the host and for extensions. It shows as a card in the chat's
 * composer and is prepended to the next message. When the chat's composer is not on screen, the chat is brought into view
 * and the card waits for it. Nothing is uploaded.
 */
export function attachCommentToChat(input: CommentToAttach): AttachResult {
  const bundle: CommentBundle = {
    id: newCommentId(),
    kind: input.kind,
    title: input.title,
    markdown: input.markdown,
    count: input.count,
    files: input.files,
    createdAt: Date.now(),
  }
  const result = attachCommentsToComposer(input.chatId, bundle)
  if (result === 'queued') {
    openChatForAttach(input.chatId)
  }
  return result
}
