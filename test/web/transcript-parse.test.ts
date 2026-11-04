import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTranscriptLine } from '../../src/web/transcript/parse.ts'

const AT = '2026-01-01T10:00:00.000Z'
const MS = Date.parse(AT)

const assistantLine = (uuid: string, content: unknown[]) =>
  JSON.stringify({ type: 'assistant', uuid, timestamp: AT, message: { id: 'msg_1', role: 'assistant', content }, apiBlockIndex: 0 })

test('parse: assistant text, tool_use with full input, tool_result with full output', () => {
  expect(parseTranscriptLine(assistantLine('a-1', [{ type: 'text', text: 'Hello' }]))).toEqual([
    { sourceId: 'a-1:0', at: MS, item: { kind: 'agent_text', markdown: 'Hello' } },
  ])

  expect(
    parseTranscriptLine(assistantLine('a-2', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la', timeout: 5000 } }])),
  ).toEqual([
    {
      sourceId: 'tool:toolu_1',
      at: MS,
      item: { kind: 'tool_use', toolUseId: 'toolu_1', tool: 'Bash', input: { command: 'ls -la', timeout: 5000 } },
    },
  ])

  const result = JSON.stringify({
    type: 'user',
    uuid: 'u-1',
    timestamp: AT,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'full output', is_error: false }] },
    toolUseResult: { stdout: 'full output', stderr: '' },
  })
  expect(parseTranscriptLine(result)).toEqual([
    { sourceId: 'tool:toolu_1', at: MS, item: { kind: 'tool_result', toolUseId: 'toolu_1', text: 'full output', isError: false } },
  ])
})

test('parse: user prompts and turn_duration markers', () => {
  const prompt = JSON.stringify({ type: 'user', uuid: 'u-2', timestamp: AT, message: { role: 'user', content: 'Fix the bug' } })
  expect(parseTranscriptLine(prompt)).toEqual([{ sourceId: 'u-2:0', at: MS, item: { kind: 'user_text', text: 'Fix the bug' } }])

  const turnEnd = JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 2953, uuid: 's-1', timestamp: AT })
  expect(parseTranscriptLine(turnEnd)).toEqual([{ sourceId: 's-1:0', at: MS, item: { kind: 'turn_end' } }])
})

test('one transcript line with text and two tool_use blocks yields three entries', () => {
  const entries = parseTranscriptLine(
    assistantLine('a-3', [
      { type: 'text', text: 'Checking' },
      { type: 'tool_use', id: 'toolu_a', name: 'Read', input: { file_path: 'x' } },
      { type: 'tool_use', id: 'toolu_b', name: 'Grep', input: { pattern: 'y' } },
    ]),
  )

  expect(entries.map(entry => entry.sourceId)).toEqual(['a-3:0', 'tool:toolu_a', 'tool:toolu_b'])
})

test('parse skips AskUserQuestion entries', () => {
  const question = assistantLine('a-4', [
    { type: 'tool_use', id: 'toolu_q', name: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [] }] } },
  ])
  const answer = JSON.stringify({
    type: 'user',
    uuid: 'u-3',
    timestamp: AT,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_q', content: 'a' }] },
    toolUseResult: { questions: [{ question: 'Which?' }], answers: { 'Which?': 'a' } },
  })

  expect(parseTranscriptLine(question)).toEqual([])
  expect(parseTranscriptLine(answer)).toEqual([])
})

// Asserts an empty array: parseTranscriptLine returns entries, so a malformed line yields none.
test('parse returns null for a malformed line', () => {
  expect(parseTranscriptLine('{"type":"assistant","uuid":')).toEqual([])
  expect(parseTranscriptLine('not json at all')).toEqual([])
  expect(parseTranscriptLine('')).toEqual([])
})

test('unknown line types and unknown block shapes are ignored without throwing', () => {
  const lines = [
    '{"type":"mystery","uuid":"m-1"}',
    '{"type":"attachment","uuid":"m-2","attachment":{}}',
    '[]',
    'null',
    '42',
    JSON.stringify({ type: 'user', uuid: 'u-4', message: { role: 'user', content: 42 } }),
    JSON.stringify({ type: 'user', uuid: 'u-5', message: { role: 'user', content: [{ type: 'image', source: {} }, null, 7] } }),
    JSON.stringify({ type: 'assistant', uuid: 'a-5', message: { content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'weird' }] } }),
    JSON.stringify({ type: 'assistant', uuid: 'a-6', message: 'not an object' }),
    JSON.stringify({ type: 'user', uuid: 'u-6', message: { content: [{ type: 'tool_result', content: 'no id' }] } }),
    JSON.stringify({ type: 'system', subtype: 'stop_hook_summary', uuid: 's-2' }),
  ]

  for (const line of lines) {
    expect(() => parseTranscriptLine(line)).not.toThrow()
    expect(parseTranscriptLine(line)).toEqual([])
  }
})

test('the synthetic finished-session fixture parses into its prompts, tool runs, answers and turn end', () => {
  const lines = readFileSync(join(import.meta.dir, '../support/transcripts/finished-session.jsonl'), 'utf8').split('\n').filter(Boolean)
  const kinds = lines.flatMap(line => parseTranscriptLine(line).map(entry => entry.item.kind))

  expect(kinds).toEqual(['user_text', 'agent_text', 'tool_use', 'tool_result', 'agent_text', 'turn_end'])
})
