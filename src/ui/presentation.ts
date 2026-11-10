import { chatState } from '../channel/web/chat-state.ts'
import type { Chat, Message, PendingPrompt } from '../channel/web/protocol.ts'
import type { ConnectionStatus } from './use-web-channel.ts'

export type MessageGroup = { kind: 'message'; message: Message } | { kind: 'tool-group'; messages: Extract<Message, { kind: 'tool_run' }>[] }

export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const message of messages) {
    if (message.kind === 'tool_run') {
      const last = groups.at(-1)
      if (last?.kind === 'tool-group') {
        last.messages.push(message)
      } else {
        groups.push({ kind: 'tool-group', messages: [message] })
      }
    } else {
      groups.push({ kind: 'message', message })
    }
  }
  return groups
}

export function isInterruptedToolGroup(
  messages: Extract<Message, { kind: 'tool_run' }>[],
  hasLaterMessage: boolean,
): boolean {
  return hasLaterMessage && messages.some(message => message.status === 'running')
}

export function promptQuestionIndex(messages: Message[], messageId: string): number {
  const targetIndex = messages.findIndex(message => message.id === messageId)
  if (targetIndex < 0) {
    return 0
  }
  const target = messages[targetIndex]
  if (target?.kind !== 'prompt') {
    return 0
  }
  return messages
    .slice(0, targetIndex)
    .filter(message => message.kind === 'prompt' && message.promptId === target.promptId).length
}

export function formatTime(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(at)
}

/** Local calendar day as a comparable key, so messages can be grouped by day. */
export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** "Today", "Yesterday", or a short date such as "Fri, 6 Nov 2026". */
export function formatDayLabel(at: number, now = Date.now()): string {
  const day = dayKey(at)
  if (day === dayKey(now)) {
    return 'Today'
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === dayKey(yesterday.getTime())) {
    return 'Yesterday'
  }
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(at)
}

export function formatRelativeTime(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at)
  if (delta < 60_000) {
    return 'now'
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m`
  }
  if (delta < 86_400_000) {
    return `${Math.floor(delta / 3_600_000)}h`
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(at)
}

export function commandToolInput(input: unknown): { command: string; description?: string; timeout?: number; runInBackground?: boolean } | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.command !== 'string'
    || Object.keys(record).some(key => !['command', 'description', 'timeout', 'run_in_background'].includes(key))
    || ('description' in record && typeof record.description !== 'string')
    || ('timeout' in record && (typeof record.timeout !== 'number' || !Number.isFinite(record.timeout)))
    || ('run_in_background' in record && typeof record.run_in_background !== 'boolean')
  ) {
    return null
  }
  return {
    command: record.command,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(typeof record.timeout === 'number' ? { timeout: record.timeout } : {}),
    ...(typeof record.run_in_background === 'boolean' ? { runInBackground: record.run_in_background } : {}),
  }
}

export function writeToolInput(input: unknown): { filePath: string; content: string } | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.file_path !== 'string'
    || typeof record.content !== 'string'
    || Object.keys(record).some(key => !['file_path', 'content'].includes(key))
  ) {
    return null
  }
  return { filePath: record.file_path, content: record.content }
}

export function isMarkdownFilePath(filePath: string): boolean {
  return /\.(?:md|markdown)$/i.test(filePath)
}

export function editToolInput(input: unknown): { filePath: string; oldString: string; newString: string; replaceAll: boolean } | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.file_path !== 'string'
    || typeof record.old_string !== 'string'
    || typeof record.new_string !== 'string'
    || ('replace_all' in record && typeof record.replace_all !== 'boolean')
    || Object.keys(record).some(key => !['file_path', 'old_string', 'new_string', 'replace_all'].includes(key))
  ) {
    return null
  }
  return {
    filePath: record.file_path,
    oldString: record.old_string,
    newString: record.new_string,
    replaceAll: record.replace_all === true,
  }
}

export type DiffLine = { kind: 'same' | 'remove' | 'add'; text: string; changed?: { start: number; end: number } }

// Above this many line pairs the table would be too large, so the diff shows the whole old block removed and the new one added.
const MAX_DIFF_CELLS = 250_000

/** Line-based diff of two strings, in display order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [...a.map(text => ({ kind: 'remove' as const, text })), ...b.map(text => ({ kind: 'add' as const, text }))]
  }
  // lcs[i][j] is the longest common subsequence of a[i..] and b[j..]; out-of-range cells count as 0.
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const cell = (i: number, j: number): number => lcs[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1))
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const removed = a[i] ?? ''
    const added = b[j] ?? ''
    if (removed === added) {
      lines.push({ kind: 'same', text: removed })
      i++
      j++
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      lines.push({ kind: 'remove', text: removed })
      i++
    } else {
      lines.push({ kind: 'add', text: added })
      j++
    }
  }
  a.slice(i).forEach(text => lines.push({ kind: 'remove', text }))
  b.slice(j).forEach(text => lines.push({ kind: 'add', text }))
  return lines
}

/**
 * Marks the characters that differ inside paired removed and added lines.
 * Lines are paired in order within each block of removals followed by additions.
 */
export function markChangedRanges(lines: DiffLine[]): DiffLine[] {
  const result: DiffLine[] = lines.map(line => ({ ...line }))
  let index = 0
  while (index < result.length) {
    if (result[index]?.kind !== 'remove') {
      index++
      continue
    }
    const removeStart = index
    while (result[index]?.kind === 'remove') {
      index++
    }
    const addStart = index
    while (result[index]?.kind === 'add') {
      index++
    }
    const pairs = Math.min(addStart - removeStart, index - addStart)
    for (let offset = 0; offset < pairs; offset++) {
      const removed = result[removeStart + offset]
      const added = result[addStart + offset]
      if (removed === undefined || added === undefined) {
        continue
      }
      const prefix = commonPrefixLength(removed.text, added.text)
      const suffix = commonSuffixLength(removed.text.slice(prefix), added.text.slice(prefix))
      removed.changed = { start: prefix, end: removed.text.length - suffix }
      added.changed = { start: prefix, end: added.text.length - suffix }
    }
  }
  return result
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length++
  }
  return length
}

function commonSuffixLength(a: string, b: string): number {
  let length = 0
  while (length < a.length && length < b.length && a[a.length - 1 - length] === b[b.length - 1 - length]) {
    length++
  }
  return length
}

export function toolInputText(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

/** What a pending Prompt is, in the words the list uses. */
export function pendingPromptLabel(prompt: PendingPrompt): string {
  return prompt.kind === 'permission' ? 'Permission' : 'Question'
}

/** The look of the "needs you" state: the --status-needs token, not the accent, so it is never mistaken for an unread count. */
export const NEEDS_YOU_TEXT_CLASS = 'text-status-needs'
export const NEEDS_YOU_BADGE_CLASS = 'border-status-needs/30 bg-status-needs/10 text-status-needs'

/** A stable hue (0-359) for a project or title, so sessions of one project share a color. */
export function avatarHue(key: string): number {
  let hash = 0
  for (const char of key) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return hash % 360
}

/** What an avatar shows for a session, so the list row and the chat header agree: the project's letter and color. */
export function chatAvatar(chat: { id: string; title: string; project: string | null }): { fallback: string; hue: number | undefined } {
  if (chat.id === 'general') {
    return { fallback: '⌘', hue: undefined }
  }
  const key = chat.project ?? chat.title
  return { fallback: key, hue: avatarHue(key) }
}

/** The same age as formatRelativeTime, in words a screen reader can say ("12 minutes ago"). */
export function relativeTimeWords(at: number, now = Date.now()): string {
  const delta = Math.max(0, now - at)
  if (delta < 60_000) {
    return 'just now'
  }
  if (delta < 3_600_000) {
    const minutes = Math.floor(delta / 60_000)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  if (delta < 86_400_000) {
    const hours = Math.floor(delta / 3_600_000)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(at)
}

/** The accessible name of a chat row. It starts with the state, so a screen reader user hears what matters first. */
export function chatRowLabel(chat: Chat, now = Date.now()): string {
  const state = chatState(chat)
  const parts: string[] = []
  if (state === 'needs_you' && chat.pendingPrompt !== null) {
    parts.push('Needs you', `${chat.pendingPrompt.kind}: ${chat.pendingPrompt.summary}`)
  } else if (state === 'working') {
    parts.push('Working')
  } else if (state === 'ended') {
    parts.push('Ended')
  }
  parts.push(chat.title)
  if (chat.pinned && chat.id !== 'general') {
    parts.push('pinned')
  }
  if (chat.id !== 'general') {
    parts.push(chat.spawned ? 'spawned session' : 'computer session')
  }
  if (chat.project !== null) {
    parts.push(chat.project)
  }
  if (chat.lastMessage !== null) {
    parts.push(relativeTimeWords(chat.lastMessage.at, now))
  }
  if (chat.unread > 0) {
    parts.push(`${chat.unread} unread`)
  }
  if (chat.draft !== null) {
    parts.push('has a draft')
  }
  return parts.join(', ')
}

/** The message to scroll to for a Prompt that waits: its first pending message. Undefined once it is answered or if it is not loaded. */
export function pendingPromptMessage(messages: Message[], promptId: string): Message | undefined {
  return messages.find(message => message.kind === 'prompt' && message.promptId === promptId && message.status === 'pending')
}

/** What a tap on a chat row asks for besides opening it: the pending Prompt of a session that needs you. */
export function rowOpenTarget(chat: Chat): { promptId: string } | undefined {
  return chatState(chat) === 'needs_you' && chat.pendingPrompt !== null ? { promptId: chat.pendingPrompt.promptId } : undefined
}

/** The chat and Prompt a link names (`/?chat=<id>&prompt=<id>`, from a notification or a shared link). A Prompt needs its chat. */
export function deepLink(search: string): { chatId: string | null; promptId: string | null } {
  const params = new URLSearchParams(search)
  const chatId = params.get('chat') || null
  return { chatId, promptId: chatId === null ? null : params.get('prompt') || null }
}

export type Segment = { text: string; match: boolean }

/**
 * Splits `text` into runs that match a search word and runs that do not, so the match can be marked. Matching ignores case and is
 * literal (a "." in a search is a dot, not a pattern); overlapping and touching matches become one run.
 */
export function highlightSegments(text: string, terms: string[]): Segment[] {
  if (text === '') {
    return []
  }
  const lower = text.toLowerCase()
  // A few characters change length when lowercased; marking by position would then be wrong, so show the text plain.
  if (lower.length !== text.length) {
    return [{ text, match: false }]
  }
  const ranges: [number, number][] = []
  for (const term of terms) {
    const needle = term.toLowerCase()
    for (let from = needle === '' ? lower.length : 0; ; ) {
      const at = lower.indexOf(needle, from)
      if (at < 0) {
        break
      }
      ranges.push([at, at + needle.length])
      from = at + 1
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last !== undefined && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push([range[0], range[1]])
    }
  }
  const segments: Segment[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false })
    }
    segments.push({ text: text.slice(start, end), match: true })
    cursor = end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false })
  }
  return segments
}

const CONNECTION_NOTICE: Partial<Record<ConnectionStatus, string>> = {
  loading: 'Connecting to your computer…',
  reconnecting: "Can't reach your computer. Reconnecting…",
  resyncing: 'Syncing recent activity…',
  error: "Can't reach your computer.",
}

/** What to tell the user about the connection, or undefined while it is fine. One wording for the list and for an open chat. */
export function connectionNoticeText(status: ConnectionStatus): string | undefined {
  return CONNECTION_NOTICE[status]
}
