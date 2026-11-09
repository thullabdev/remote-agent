import { describe, expect, test } from 'bun:test'
import type { Chat, Message } from '../../src/channel/web/protocol.ts'
import { avatarHue, chatRowLabel, relativeTimeWords, commandToolInput, dayKey, diffLines, editToolInput, markChangedRanges, formatDayLabel, groupMessages, isInterruptedToolGroup, isMarkdownFilePath, promptQuestionIndex, writeToolInput } from '../../src/ui/presentation.ts'

const tool = (id: string, seq: number): Extract<Message, { kind: 'tool_run' }> => ({
  id,
  chatId: 'c_1',
  seq,
  at: seq,
  kind: 'tool_run',
  tool: 'read_file',
  input: { path: '/tmp/file' },
  result: 'contents',
  resultTruncated: false,
  status: 'done',
  durationMs: 120,
})

describe('chat message presentation', () => {
  test('recognizes command, description, and optional timeout tool inputs', () => {
    expect(commandToolInput({ command: 'bun test', description: 'Run tests', timeout: 5000, run_in_background: true })).toEqual({
      command: 'bun test',
      description: 'Run tests',
      timeout: 5000,
      runInBackground: true,
    })
    expect(commandToolInput({ command: 'pwd' })).toEqual({ command: 'pwd' })
    expect(commandToolInput({ command: 'pwd', run_in_background: false })).toEqual({ command: 'pwd', runInBackground: false })
  })

  test('leaves other tool input shapes as plain JSON', () => {
    expect(commandToolInput({ path: '/tmp/file' })).toBeNull()
    expect(commandToolInput({ command: 'bun test', cwd: '/tmp' })).toBeNull()
    expect(commandToolInput({ command: 'bun test', timeout: 'soon' })).toBeNull()
    expect(commandToolInput({ command: 'bun test', run_in_background: 'yes' })).toBeNull()
  })

  test('recognizes file path and content for Write tool inputs', () => {
    expect(writeToolInput({ file_path: 'src/example.ts', content: 'export const value = 1\n' })).toEqual({
      filePath: 'src/example.ts',
      content: 'export const value = 1\n',
    })
    expect(writeToolInput({ file_path: 'empty.txt', content: '' })).toEqual({ filePath: 'empty.txt', content: '' })
  })

  test('leaves unrecognized Write inputs as plain JSON', () => {
    expect(writeToolInput({ file_path: 'src/example.ts' })).toBeNull()
    expect(writeToolInput({ file_path: 'src/example.ts', content: 'ok', extra: true })).toBeNull()
    expect(writeToolInput({ file_path: 42, content: 'ok' })).toBeNull()
  })

  test('detects Markdown Write targets case-insensitively', () => {
    expect(isMarkdownFilePath('README.md')).toBe(true)
    expect(isMarkdownFilePath('docs/guide.MARKDOWN')).toBe(true)
    expect(isMarkdownFilePath('src/example.ts')).toBe(false)
    expect(isMarkdownFilePath('notes.md.ts')).toBe(false)
  })

  test('groups only adjacent tool messages into one run', () => {
    const first = tool('m_1', 1)
    const second = tool('m_2', 2)
    const fourth = tool('m_4', 4)
    const messages: Message[] = [
      first,
      second,
      { id: 'm_3', chatId: 'c_1', seq: 3, at: 3, kind: 'agent_text', markdown: 'Done' },
      fourth,
    ]

    expect(groupMessages(messages)).toEqual([
      { kind: 'tool-group', messages: [first, second] },
      { kind: 'message', message: messages[2]! },
      { kind: 'tool-group', messages: [fourth] },
    ])
  })

  test('marks only running tool groups followed by another message as interrupted', () => {
    const completed = tool('m_1', 1)
    const running = { ...tool('m_2', 2), status: 'running' as const }

    expect(isInterruptedToolGroup([completed], true)).toBe(false)
    expect(isInterruptedToolGroup([running], false)).toBe(false)
    expect(isInterruptedToolGroup([running], true)).toBe(true)
  })

  test('derives a prompt question index from its order among messages with the same prompt id', () => {
    const messages: Message[] = [
      { id: 'p_1', chatId: 'c_1', seq: 1, at: 1, kind: 'prompt', promptId: 'prompt-1', title: 'First', body: { kind: 'question', questions: [{ question: 'One?', header: '', multiSelect: false, options: [], answered: null }] }, status: 'pending', resolution: null },
      { id: 'other', chatId: 'c_1', seq: 2, at: 2, kind: 'prompt', promptId: 'prompt-2', title: 'Other', body: { kind: 'question', questions: [{ question: 'Else?', header: '', multiSelect: false, options: [], answered: null }] }, status: 'pending', resolution: null },
      { id: 'p_2', chatId: 'c_1', seq: 3, at: 3, kind: 'prompt', promptId: 'prompt-1', title: 'Second', body: { kind: 'question', questions: [{ question: 'Two?', header: '', multiSelect: false, options: [], answered: null }] }, status: 'pending', resolution: null },
    ]

    expect(promptQuestionIndex(messages, 'p_1')).toBe(0)
    expect(promptQuestionIndex(messages, 'p_2')).toBe(1)
  })
})

describe('day labels', () => {
  const now = new Date(2026, 10, 7, 12).getTime()

  test('labels the current day as Today and the previous day as Yesterday', () => {
    expect(formatDayLabel(new Date(2026, 10, 7, 9).getTime(), now)).toBe('Today')
    expect(formatDayLabel(new Date(2026, 10, 6, 23).getTime(), now)).toBe('Yesterday')
  })

  test('uses a short date for older days and groups by local calendar day', () => {
    expect(formatDayLabel(new Date(2026, 10, 2, 9).getTime(), now)).not.toMatch(/Today|Yesterday/)
    expect(dayKey(new Date(2026, 10, 6, 0, 5).getTime())).toBe(dayKey(new Date(2026, 10, 6, 23, 55).getTime()))
  })
})

describe('edit tool input', () => {
  test('reads file path, old and new strings, and replace_all', () => {
    expect(editToolInput({ file_path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true })).toEqual({
      filePath: 'a.ts', oldString: 'x', newString: 'y', replaceAll: true,
    })
    expect(editToolInput({ file_path: 'a.ts', old_string: 'x', new_string: 'y' })?.replaceAll).toBe(false)
  })

  test('rejects inputs with unexpected keys or types', () => {
    expect(editToolInput({ file_path: 'a.ts', old_string: 'x' })).toBeNull()
    expect(editToolInput({ file_path: 'a.ts', old_string: 'x', new_string: 'y', extra: 1 })).toBeNull()
    expect(editToolInput({ file_path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: 'yes' })).toBeNull()
  })
})

describe('line diff', () => {
  test('marks changed lines and keeps unchanged ones as context', () => {
    expect(diffLines('one\ntwo\nthree', 'one\n2\nthree')).toEqual([
      { kind: 'same', text: 'one' },
      { kind: 'remove', text: 'two' },
      { kind: 'add', text: '2' },
      { kind: 'same', text: 'three' },
    ])
  })

  test('treats an empty old string as pure insertion', () => {
    expect(diffLines('', 'a\nb')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ])
  })

  test('treats an empty new string as pure deletion', () => {
    expect(diffLines('a', '')).toEqual([{ kind: 'remove', text: 'a' }])
  })
})

describe('changed ranges', () => {
  test('highlights only the characters that differ in a paired line', () => {
    const lines = markChangedRanges(diffLines('const total = price * 2', 'const total = price * 3'))
    expect(lines).toEqual([
      { kind: 'remove', text: 'const total = price * 2', changed: { start: 22, end: 23 } },
      { kind: 'add', text: 'const total = price * 3', changed: { start: 22, end: 23 } },
    ])
  })

  test('leaves unpaired lines without a highlight', () => {
    const lines = markChangedRanges(diffLines('a', 'b\nc'))
    expect(lines.map(line => line.changed)).toEqual([{ start: 0, end: 1 }, { start: 0, end: 1 }, undefined])
  })
})

describe('chat row helpers', () => {
  const now = Date.UTC(2026, 10, 10, 12, 0)

  test('avatarHue is stable per key, in range, and differs for different projects', () => {
    expect(avatarHue('remote-agent')).toBe(avatarHue('remote-agent'))
    expect(avatarHue('remote-agent')).not.toBe(avatarHue('vulcan'))
    for (const key of ['', 'a', 'remote-agent', 'ü', '😀 emoji']) {
      expect(avatarHue(key)).toBeGreaterThanOrEqual(0)
      expect(avatarHue(key)).toBeLessThan(360)
    }
  })

  test('relativeTimeWords reads aloud what formatRelativeTime abbreviates', () => {
    expect(relativeTimeWords(now - 10_000, now)).toBe('just now')
    expect(relativeTimeWords(now - 60_000, now)).toBe('1 minute ago')
    expect(relativeTimeWords(now - 12 * 60_000, now)).toBe('12 minutes ago')
    expect(relativeTimeWords(now - 3_600_000, now)).toBe('1 hour ago')
    expect(relativeTimeWords(now - 7 * 3_600_000, now)).toBe('7 hours ago')
    expect(relativeTimeWords(now - 3 * 86_400_000, now)).toMatch(/Nov/)
  })

  const chat: Chat = {
    id: 'c1', title: 'Billing fix', project: 'api', cwd: '/api', status: 'active', spawned: false, archived: false, busy: false, unread: 0,
    lastMessage: { seq: 1, at: now - 12 * 60_000, preview: 'Done with the migration' }, draft: null, pinned: false, tmuxName: null, pendingPrompt: null,
  }

  test('chatRowLabel starts with the state, then title, project and age', () => {
    expect(chatRowLabel(chat, now)).toBe('Billing fix, computer session, api, 12 minutes ago')
    expect(chatRowLabel({ ...chat, busy: true }, now)).toBe('Working, Billing fix, computer session, api, 12 minutes ago')
    expect(chatRowLabel({ ...chat, status: 'ended' }, now)).toBe('Ended, Billing fix, computer session, api, 12 minutes ago')
    expect(
      chatRowLabel({ ...chat, busy: true, pendingPrompt: { promptId: 'p', kind: 'permission', summary: 'Bash: ls', at: 1, count: 1 } }, now),
    ).toBe('Needs you, permission: Bash: ls, Billing fix, computer session, api, 12 minutes ago')
    expect(chatRowLabel({ ...chat, spawned: true }, now)).toBe('Billing fix, spawned session, api, 12 minutes ago')
    expect(chatRowLabel({ ...chat, id: 'general', title: 'General', project: null }, now)).toBe('General, 12 minutes ago')
    expect(chatRowLabel({ ...chat, unread: 3, draft: { preview: 'x', at: 1 } }, now)).toBe('Billing fix, computer session, api, 12 minutes ago, 3 unread, has a draft')
  })
})
