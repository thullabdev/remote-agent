import { describe, expect, test } from 'bun:test'
import type { Message } from '../../src/channel/web/protocol.ts'
import { groupMessages, isInterruptedToolGroup, promptQuestionIndex } from '../../src/ui/presentation.ts'

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
