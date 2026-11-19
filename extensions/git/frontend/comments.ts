import type { OpenStateStorage } from '../../../src/ui/components/ui/accordion-state.ts'
import type { AttachResult } from '../../../src/ui/composer-bus.ts'
import type { CommentToAttach } from '../../../src/ui/attach-comment.ts'
import type { DiffLine } from '../backend/parse.ts'

export type CommentScope = 'staged' | 'unstaged' | 'commit'

/**
 * A note on one diff line, or on a range of rows in one hunk. `line` is the number on `side`: the new side for added and context
 * lines, the old side for removed lines. A range runs from `line` to `endLine` on the same side, and `quote` holds the text of
 * every row in it, one per line. Single-line comments omit `endLine` and `quote`.
 */
export type Comment = {
  id: string
  path: string
  scope: CommentScope
  sha?: string
  side: 'new' | 'old'
  line: number
  endLine?: number
  lineText: string
  quote?: string
  text: string
  createdAt: number
}

/** Where a comment is made on a diff line: the line's number on its side, and the line's text. */
export type LineAnchor = { side: 'new' | 'old'; line: number; lineText: string }

/** The anchor of a range of rows: `endLine` and `quote` are set only when the range has more than one row. */
export type RangeAnchor = LineAnchor & { endLine?: number; quote?: string }

export const COMMENTS_STORAGE_KEY = 'remote-agent.git.comments.v1'
/** The most text one attachment may carry, in UTF-8 bytes. */
export const MAX_ATTACH_BYTES = 65536
/** The most comments one attachment may carry. */
export const MAX_ATTACH_COMMENTS = 200

const SCOPES: readonly string[] = ['staged', 'unstaged', 'commit']
const CHANGED_EVENT = 'remote-agent.git.comments-changed'

function isComment(value: unknown): value is Comment {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as Record<string, unknown>
  if (
    typeof entry.id !== 'string' ||
    typeof entry.path !== 'string' ||
    typeof entry.scope !== 'string' ||
    !SCOPES.includes(entry.scope) ||
    typeof entry.lineText !== 'string' ||
    typeof entry.text !== 'string' ||
    typeof entry.createdAt !== 'number' ||
    !Number.isFinite(entry.createdAt)
  ) {
    return false
  }
  if (entry.side !== 'new' && entry.side !== 'old') {
    return false
  }
  if (typeof entry.line !== 'number' || !Number.isInteger(entry.line) || entry.line < 1) {
    return false
  }
  if (entry.sha !== undefined && typeof entry.sha !== 'string') {
    return false
  }
  if (entry.endLine !== undefined && (typeof entry.endLine !== 'number' || !Number.isInteger(entry.endLine) || entry.endLine < 1)) {
    return false
  }
  if (entry.quote !== undefined && typeof entry.quote !== 'string') {
    return false
  }
  return entry.scope !== 'commit' || typeof entry.sha === 'string'
}

/** The whole stored map. Null when storage cannot be read, so a write is skipped and other chats' comments are not lost. */
function readMap(storage: OpenStateStorage): Record<string, unknown> | null {
  let raw: string | null
  try {
    raw = storage.getItem(COMMENTS_STORAGE_KEY)
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

/** Writes one chat's list into the stored map. A failed write is ignored: the caller still gets the new list for this session. */
function writeChat(storage: OpenStateStorage, chatId: string, list: Comment[]): void {
  const map = readMap(storage)
  if (map === null) {
    return
  }
  try {
    storage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify({ ...map, [chatId]: list }))
  } catch {
    // Storage unavailable or full: the comments still work for this session.
  }
}

/** The chat's comments. Malformed entries are dropped. Empty when storage is missing or unreadable. */
export function readComments(storage: OpenStateStorage | null, chatId: string): Comment[] {
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
  return entries.filter(isComment)
}

/** Adds a comment to the chat and returns the chat's new list. */
export function addComment(storage: OpenStateStorage | null, chatId: string, comment: Comment): Comment[] {
  const next = [...readComments(storage, chatId), comment]
  if (storage) {
    writeChat(storage, chatId, next)
  }
  return next
}

/** Removes the comment with `id` from the chat and returns the chat's new list. */
export function removeComment(storage: OpenStateStorage | null, chatId: string, id: string): Comment[] {
  const next = readComments(storage, chatId).filter(comment => comment.id !== id)
  if (storage) {
    writeChat(storage, chatId, next)
  }
  return next
}

/** Removes every comment of the chat and returns an empty list. */
export function clearComments(storage: OpenStateStorage | null, chatId: string): Comment[] {
  if (storage) {
    writeChat(storage, chatId, [])
  }
  return []
}

/**
 * The comments shown under one diff row. A comment is shown under its last row: the row whose number on the comment's side is
 * the comment's `endLine`, or its `line` for a single-line comment. A commit's sha must match; other scopes have none.
 */
export function commentsForRow(comments: Comment[], path: string, scope: CommentScope, sha: string | undefined, row: LineAnchor): Comment[] {
  return comments.filter(
    comment =>
      comment.path === path &&
      comment.scope === scope &&
      (comment.sha ?? '') === (sha ?? '') &&
      comment.side === row.side &&
      (comment.endLine ?? comment.line) === row.line,
  )
}

/** The anchor a diff line takes when commented on, or null for meta lines and lines without a number on their side. */
export function anchorForLine(line: DiffLine): LineAnchor | null {
  if (line.kind === 'meta') {
    return null
  }
  if (line.kind === 'removed') {
    if (line.oldLine === null) {
      return null
    }
    return { side: 'old', line: line.oldLine, lineText: line.text }
  }
  if (line.newLine === null) {
    return null
  }
  return { side: 'new', line: line.newLine, lineText: line.text }
}

/**
 * The anchor of a selection of rows from one hunk, in display order, or null when no row has a number on either side.
 * A row with a new-side number anchors the range on the new side: `line` is the first new-side number and `endLine` the last.
 * When no row has one, the range anchors on the old side. A single row gives the same anchor as `anchorForLine`.
 */
export function anchorForRange(rows: DiffLine[]): RangeAnchor | null {
  const only = rows[0]
  if (rows.length === 1 && only !== undefined) {
    return anchorForLine(only)
  }
  const newNumbers = rows.flatMap(row => (row.newLine === null ? [] : [row.newLine]))
  const oldNumbers = rows.flatMap(row => (row.oldLine === null ? [] : [row.oldLine]))
  const side: 'new' | 'old' = newNumbers.length > 0 ? 'new' : 'old'
  const numbers = side === 'new' ? newNumbers : oldNumbers
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  if (first === undefined || last === undefined) {
    return null
  }
  return {
    side,
    line: first,
    endLine: last,
    lineText: rows[0]?.text ?? '',
    quote: rows.map(row => row.text).join('\n'),
  }
}

function compareValues(a: string | number, b: string | number): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}

function compareComments(a: Comment, b: Comment): number {
  return (
    compareValues(a.path, b.path) ||
    compareValues(a.line, b.line) ||
    compareValues(a.side, b.side) ||
    compareValues(a.createdAt, b.createdAt) ||
    compareValues(a.id, b.id)
  )
}

/** The `path:line` label of a comment: `12` for the new side, `old 12` for the old side. A range reads `new 12-18` or `old 12-18`. */
function anchorLabel(comment: Comment): string {
  const isRange = comment.endLine !== undefined && comment.endLine !== comment.line
  if (isRange) {
    return `${comment.side} ${comment.line}-${comment.endLine}`
  }
  return comment.side === 'old' ? `old ${comment.line}` : `${comment.line}`
}

function scopeText(comment: Comment): string {
  if (comment.scope === 'commit') {
    return comment.sha === undefined || comment.sha === '' ? 'commit' : `commit ${comment.sha.slice(0, 7)}`
  }
  return comment.scope
}

/** A code fence longer than any run of backticks in the quoted text, so the text cannot close it. */
function fenceFor(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * The attachment's markdown. Comments are grouped by path (sorted), then listed in line order. The output depends only on the
 * comments and the branch, so the same input always gives the same text.
 */
export function buildCommentsMarkdown(comments: Comment[], branch: string | null): string {
  const out: string[] = ['# Review comments', '', `Branch: ${branch === null || branch === '' ? 'detached' : branch}`, '']
  let currentPath: string | null = null
  for (const comment of [...comments].sort(compareComments)) {
    if (comment.path !== currentPath) {
      out.push(`## ${comment.path}`, '')
      currentPath = comment.path
    }
    const quoted = comment.quote ?? comment.lineText
    const fence = fenceFor(quoted)
    out.push(`### ${comment.path}:${anchorLabel(comment)}`, '', `scope: ${scopeText(comment)}`, '', fence, quoted, fence, '', comment.text, '')
  }
  return out.join('\n')
}

/** The UTF-8 byte length of a text. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/** Why the comments cannot be attached, as a message for the person, or null when they can. */
export function attachmentProblem(count: number, markdown: string): string | null {
  if (count > MAX_ATTACH_COMMENTS) {
    return `Too many comments to attach at once (${count}). The limit is ${MAX_ATTACH_COMMENTS}. Remove some comments first.`
  }
  const bytes = utf8ByteLength(markdown)
  if (bytes > MAX_ATTACH_BYTES) {
    return `The comments are too long to attach (${bytes} bytes, the limit is ${MAX_ATTACH_BYTES}). Shorten or remove some comments.`
  }
  return null
}

export type AttachOutcome = { status: 'attached' } | { status: 'refused'; message: string }

/**
 * Builds the review as a comment bundle and hands it to the chat's composer, which shows it as a card and prepends it to the next
 * message. Nothing is uploaded. The comments are not cleared here: the caller clears them only on 'attached'.
 */
export function attachComments(input: {
  chatId: string
  comments: Comment[]
  branch: string | null
  /** The host's attach for a comment card: shown by the composer now, or queued until the composer mounts. */
  attach(card: CommentToAttach): AttachResult
}): AttachOutcome {
  if (input.comments.length === 0) {
    return { status: 'refused', message: 'There are no comments to attach.' }
  }
  const markdown = buildCommentsMarkdown(input.comments, input.branch)
  const problem = attachmentProblem(input.comments.length, markdown)
  if (problem !== null) {
    return { status: 'refused', message: problem }
  }
  const result = input.attach({
    chatId: input.chatId,
    kind: 'comments',
    title: `Review comments · ${input.comments.length} ${input.comments.length === 1 ? 'comment' : 'comments'}`,
    markdown,
    count: input.comments.length,
    files: [...new Set(input.comments.map(comment => comment.path))].sort(),
  })
  if (result === 'full') {
    return { status: 'refused', message: 'The chat cannot take the comments right now. Try again.' }
  }
  return { status: 'attached' }
}

/** Tells the other comment views in this window that the stored comments changed. */
export function announceCommentsChanged(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.dispatchEvent(new Event(CHANGED_EVENT))
  } catch {
    // No event target: the other views refresh on their next render.
  }
}

/** Calls `listener` when the stored comments change in this window. The returned function stops the calls. */
export function subscribeCommentsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  window.addEventListener(CHANGED_EVENT, listener)
  return () => window.removeEventListener(CHANGED_EVENT, listener)
}
