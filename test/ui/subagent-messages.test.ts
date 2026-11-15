import { expect, test } from 'bun:test'
import type { TranscriptItem } from '../../src/channel/web/transcript/parse.ts'
import { subagentMessages } from '../../src/ui/subagent-messages.ts'

const CHAT = 'c1'

test('a sub-agent prompt and its text become the chat\'s user and agent messages, in order', () => {
  const items: TranscriptItem[] = [
    { kind: 'user_text', text: 'Review the spike.' },
    { kind: 'agent_text', markdown: 'Reading the files.' },
  ]
  expect(subagentMessages(CHAT, items)).toMatchObject([
    { kind: 'user_text', text: 'Review the spike.', status: 'delivered', chatId: CHAT, at: 0 },
    { kind: 'agent_text', markdown: 'Reading the files.' },
  ])
})

test('a tool result joins the tool use it answers, and keeps its error status', () => {
  const items: TranscriptItem[] = [
    { kind: 'tool_use', toolUseId: 't1', tool: 'Read', input: { file_path: 'a.ts' } },
    { kind: 'tool_use', toolUseId: 't2', tool: 'Bash', input: { command: 'ls' } },
    { kind: 'tool_result', toolUseId: 't2', text: 'boom', isError: true },
    { kind: 'tool_result', toolUseId: 't1', text: 'file body', isError: false },
  ]
  const messages = subagentMessages(CHAT, items)
  expect(messages).toHaveLength(2)
  expect(messages[0]).toMatchObject({ kind: 'tool_run', tool: 'Read', result: 'file body', status: 'done' })
  expect(messages[1]).toMatchObject({ kind: 'tool_run', tool: 'Bash', result: 'boom', status: 'error' })
})

test('a tool still waiting for its result is running, and a result with no use is a finished unknown run', () => {
  const messages = subagentMessages(CHAT, [
    { kind: 'tool_use', toolUseId: 't1', tool: 'Grep', input: { pattern: 'x' } },
    { kind: 'tool_result', toolUseId: 'missing', text: 'orphan', isError: false },
  ])
  expect(messages[0]).toMatchObject({ kind: 'tool_run', tool: 'Grep', status: 'running', result: null })
  expect(messages[1]).toMatchObject({ kind: 'tool_run', tool: 'unknown', status: 'done', result: 'orphan' })
})

test('messages get distinct ids and sequence numbers that follow the activity', () => {
  const messages = subagentMessages(CHAT, [
    { kind: 'user_text', text: 'a' },
    { kind: 'agent_text', markdown: 'b' },
    { kind: 'tool_use', toolUseId: 't1', tool: 'Read', input: null },
  ])
  expect(messages.map(message => message.seq)).toEqual([0, 1, 2])
  expect(new Set(messages.map(message => message.id)).size).toBe(3)
})
