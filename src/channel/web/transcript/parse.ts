// Parses one line of a Claude Code transcript (.jsonl). Unknown or malformed input yields no entries; this never throws.

export type TranscriptItem =
  | { kind: 'agent_text'; markdown: string }
  | { kind: 'tool_use'; toolUseId: string; tool: string; input: unknown }
  | { kind: 'tool_result'; toolUseId: string; text: string; isError: boolean }
  | { kind: 'user_text'; text: string }
  | { kind: 'turn_end' }
  /** An AskUserQuestion tool_use: not shown, but its result must be dropped too. */
  | { kind: 'ignored_tool_use'; toolUseId: string }

/** sourceId is `<uuid>:<blockIndex>` for text and turn markers, and `tool:<toolUseId>` for tool_use and tool_result. */
export type TranscriptEntry = { sourceId: string; at: number; item: TranscriptItem }

type Json = Record<string, unknown>

const ASK_USER_QUESTION = 'AskUserQuestion'

// Local slash commands, task notifications and their output are bookkeeping, not conversation: they show nothing and never mark a turn open.
const NOISE_PREFIXES = ['<command-name>', '<command-message>', '<command-args>', '<local-command-', '<task-notification>']
// An interrupt (Esc) writes no turn_duration, so the marker itself ends the turn.
const INTERRUPT_MARKERS = new Set(['[Request interrupted by user]', '[Request interrupted by user for tool use]'])

/** What a user text line means: a prompt, a turn end (interrupt), or nothing shown. */
function userTextItem(text: string): TranscriptItem | null {
  const trimmed = text.trim()
  if (trimmed === '') {
    return null
  }
  if (INTERRUPT_MARKERS.has(trimmed)) {
    return { kind: 'turn_end' }
  }
  if (NOISE_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    return null
  }
  return { kind: 'user_text', text }
}

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function timeOf(value: unknown): number {
  if (typeof value !== 'string') {
    return 0
  }
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? 0 : ms
}

// A tool_result's text: a plain string, or the text blocks of a list. Anything else has no text.
function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .flatMap(block => (isObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
      .join('\n')
  }
  return ''
}

// The answer to an AskUserQuestion comes back with its questions and answers on toolUseResult.
function isQuestionAnswer(entry: Json): boolean {
  return isObject(entry.toolUseResult) && ('questions' in entry.toolUseResult || 'answers' in entry.toolUseResult)
}

function parseUser(entry: Json, uuid: string | null, at: number, message: Json): TranscriptEntry[] {
  const content = message.content
  if (typeof content === 'string') {
    const item = userTextItem(content)
    if (uuid === null || item === null) {
      return []
    }
    return [{ sourceId: `${uuid}:0`, at, item }]
  }
  if (!Array.isArray(content)) {
    return []
  }
  const entries: TranscriptEntry[] = []
  for (const [index, block] of content.entries()) {
    if (!isObject(block)) {
      continue
    }
    if (block.type === 'tool_result') {
      if (typeof block.tool_use_id !== 'string' || isQuestionAnswer(entry)) {
        continue
      }
      entries.push({
        sourceId: `tool:${block.tool_use_id}`,
        at,
        item: { kind: 'tool_result', toolUseId: block.tool_use_id, text: resultText(block.content), isError: block.is_error === true },
      })
    } else if (block.type === 'text' && typeof block.text === 'string' && uuid !== null) {
      const item = userTextItem(block.text)
      if (item !== null) {
        entries.push({ sourceId: `${uuid}:${index}`, at, item })
      }
    }
  }
  return entries
}

function parseAssistant(uuid: string | null, at: number, message: Json): TranscriptEntry[] {
  if (!Array.isArray(message.content)) {
    return []
  }
  const entries: TranscriptEntry[] = []
  for (const [index, block] of message.content.entries()) {
    if (!isObject(block)) {
      continue
    }
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '' && uuid !== null) {
      entries.push({ sourceId: `${uuid}:${index}`, at, item: { kind: 'agent_text', markdown: block.text } })
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      const item: TranscriptItem =
        block.name === ASK_USER_QUESTION
          ? { kind: 'ignored_tool_use', toolUseId: block.id }
          : { kind: 'tool_use', toolUseId: block.id, tool: block.name, input: block.input ?? null }
      entries.push({ sourceId: `tool:${block.id}`, at, item })
    }
  }
  return entries
}

function parseEntry(value: unknown): TranscriptEntry[] {
  if (!isObject(value)) {
    return []
  }
  // Sidechain and meta lines are internal (a sub-agent's work, or injected context), not the chat's conversation.
  // A compaction summary is written as a user line, but Claude Code made it, not the user, and nothing follows it until the user
  // writes again: shown as a message it would be a wall of text, and counted as a turn it would leave the chat busy.
  if (value.isSidechain === true || value.isMeta === true || value.isCompactSummary === true) {
    return []
  }
  const uuid = typeof value.uuid === 'string' ? value.uuid : null
  const at = timeOf(value.timestamp)
  if (value.type === 'system') {
    if (value.subtype === 'turn_duration' && uuid !== null) {
      return [{ sourceId: `${uuid}:0`, at, item: { kind: 'turn_end' } }]
    }
    return []
  }
  if (!isObject(value.message)) {
    return []
  }
  if (value.type === 'user') {
    return parseUser(value, uuid, at, value.message)
  }
  if (value.type === 'assistant') {
    return parseAssistant(uuid, at, value.message)
  }
  return []
}

export function parseTranscriptLine(line: string): TranscriptEntry[] {
  try {
    return parseEntry(JSON.parse(line))
  } catch {
    return []
  }
}
