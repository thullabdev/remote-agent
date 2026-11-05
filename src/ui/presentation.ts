import type { Message } from '../channel/web/protocol.ts'

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

export function commandToolInput(input: unknown): { command: string; description?: string; timeout?: number } | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.command !== 'string'
    || Object.keys(record).some(key => !['command', 'description', 'timeout'].includes(key))
    || ('description' in record && typeof record.description !== 'string')
    || ('timeout' in record && (typeof record.timeout !== 'number' || !Number.isFinite(record.timeout)))
  ) {
    return null
  }
  return {
    command: record.command,
    ...(typeof record.description === 'string' ? { description: record.description } : {}),
    ...(typeof record.timeout === 'number' ? { timeout: record.timeout } : {}),
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
