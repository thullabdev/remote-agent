import { describe, expect, test } from 'bun:test'
import type { Message } from '../../src/channel/web/protocol.ts'
import { commandToolInput, groupMessages, isInterruptedToolGroup, isMarkdownFilePath, promptQuestionIndex, writeToolInput } from '../../src/ui/presentation.ts'

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
    expect(commandToolInput({ command: 'bun test', description: 'Run tests', timeout: 5000 })).toEqual({
      command: 'bun test',
      description: 'Run tests',
      timeout: 5000,
    })
    expect(commandToolInput({ command: 'pwd' })).toEqual({ command: 'pwd' })
  })

  test('leaves other tool input shapes as plain JSON', () => {
    expect(commandToolInput({ path: '/tmp/file' })).toBeNull()
    expect(commandToolInput({ command: 'bun test', cwd: '/tmp' })).toBeNull()
    expect(commandToolInput({ command: 'bun test', timeout: 'soon' })).toBeNull()
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
