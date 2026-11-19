import type { OpenStateStorage } from './components/ui/accordion-state.ts'

/**
 * What a bundle holds: a review's git comments ('comments') or a quote of a span of chat text ('quote').
 */
export type CommentBundleKind = 'quote' | 'comments'

/**
 * Content held by the chat composer until the next message is sent. The markdown is prepended to that message's text. `title` is the
 * label the composer card shows. `count` is the number of comments (1 for a quote) and `files` the distinct paths they are on.
 */
export type CommentBundle = {
  id: string
  kind: CommentBundleKind
  title: string
  markdown: string
  count: number
  files: string[]
  createdAt: number
}

export const COMMENT_BUNDLES_STORAGE_KEY = 'remote-agent.composer.comment-bundles.v1'

/** The title for a bundle stored without one: a git review's comment count, or the plain quote label. */
function defaultTitle(kind: CommentBundleKind, count: number): string {
  if (kind === 'quote') {
    return 'Quote'
  }
  return `Review comments · ${count} ${count === 1 ? 'comment' : 'comments'}`
}

/** Old stored bundles have no kind or title: they are git comment bundles with the title their card showed. */
function withDefaults(entry: Record<string, unknown>): CommentBundle {
  const kind: CommentBundleKind = entry.kind === 'quote' ? 'quote' : 'comments'
  const count = entry.count as number
  const title = typeof entry.title === 'string' ? entry.title : defaultTitle(kind, count)
  return { ...(entry as Omit<CommentBundle, 'kind' | 'title'>), kind, title }
}

function isBundle(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || typeof entry.markdown !== 'string' || typeof entry.createdAt !== 'number') {
    return false
  }
  if (typeof entry.count !== 'number' || !Number.isInteger(entry.count) || entry.count < 0) {
    return false
  }
  if (entry.title !== undefined && typeof entry.title !== 'string') {
    return false
  }
  return Array.isArray(entry.files) && entry.files.every(file => typeof file === 'string')
}

/** The whole stored map. Null when storage cannot be read, so a write is skipped and other chats' bundles are not lost. */
function readMap(storage: OpenStateStorage): Record<string, unknown> | null {
  let raw: string | null
  try {
    raw = storage.getItem(COMMENT_BUNDLES_STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

/** The chat's bundles, in the order they were added. Malformed entries are dropped. Empty when storage is missing or unreadable. */
export function readBundles(storage: OpenStateStorage | null, chatId: string): CommentBundle[] {
  if (!storage) {
    return []
  }
  const map = readMap(storage)
  if (map === null) {
    return []
  }
  const entries: unknown = map[chatId]
  if (!Array.isArray(entries)) {
    return []
  }
  return entries.filter(isBundle).map(withDefaults)
}

/** Stores the chat's bundles in the shared map. A chat with no bundles has its key removed. A failed write is ignored. */
export function writeBundles(storage: OpenStateStorage | null, chatId: string, bundles: CommentBundle[]): void {
  if (!storage) {
    return
  }
  const map = readMap(storage)
  if (map === null) {
    return
  }
  const next: Record<string, unknown> = { ...map }
  if (bundles.length === 0) {
    delete next[chatId]
  } else {
    next[chatId] = bundles
  }
  try {
    storage.setItem(COMMENT_BUNDLES_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable or full: the bundles still work for this session.
  }
}

/**
 * The text a message is sent with: each bundle's markdown in order, a blank line apart, then a blank line and the text.
 * With no bundles the text is returned unchanged; with empty text only the bundles' markdown is returned.
 */
export function bundleMessage(bundles: CommentBundle[], text: string): string {
  if (bundles.length === 0) {
    return text
  }
  const markdown = bundles.map(bundle => bundle.markdown.replace(/\n+$/, '')).join('\n\n')
  if (text === '') {
    return markdown
  }
  return `${markdown}\n\n${text}`
}
