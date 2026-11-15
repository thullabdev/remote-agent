import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSubagentActivity, subagentFile } from '../../../src/channel/web/transcript/subagent.ts'

const SESSION = { id: 'sess1', cwd: '/work/app', launchCwd: '/work/app' }
const AGENT = 'aa10f50e669740014'

async function fixture(lines: string[]): Promise<{ home: string; file: string }> {
  const home = await mkdtemp(join(tmpdir(), 'subagent-'))
  const dir = join(home, '.claude', 'projects', '-work-app', SESSION.id, 'subagents')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `agent-${AGENT}.jsonl`)
  await writeFile(file, lines.join('\n') + '\n')
  return { home, file }
}

const prompt = JSON.stringify({ isSidechain: true, uuid: 'u-prompt', type: 'user', message: { role: 'user', content: 'Review the spike.' } })
const thought = JSON.stringify({
  isSidechain: true,
  uuid: 'u-thought',
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Reading the files.' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } }] },
})
const result = JSON.stringify({
  isSidechain: true,
  uuid: 'u-result',
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file body' }] },
})
const handback = (message: string) =>
  JSON.stringify({
    isSidechain: true,
    agentId: AGENT,
    uuid: 'u-handback',
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'SubagentHandback', input: { message } }] },
  })

test('the subagent file sits next to the Session transcript, by launch folder and agent id', async () => {
  const path = await subagentFile('/home/x', SESSION, AGENT)
  expect(path).toBe(join('/home/x', '.claude', 'projects', '-work-app', 'sess1', 'subagents', `agent-${AGENT}.jsonl`))
})

test('an agent id that is not a plain id is refused before it is joined into a path', async () => {
  await expect(subagentFile('/home/x', SESSION, '../etc')).rejects.toThrow()
})

test('activity keeps the sub-agent lines the chat leaves out, in order', async () => {
  const { file } = await fixture([prompt, thought, result, handback('done')])
  const page = await readSubagentActivity(file, 0, 100)
  expect(page?.nextCursor).toBeNull()
  expect(page?.items.map(item => item.kind)).toEqual(['user_text', 'agent_text', 'tool_use', 'tool_result', 'tool_use'])
})

test('activity pages by line, and the next page resumes where the last one stopped', async () => {
  const { file } = await fixture([prompt, thought, result, handback('done')])
  const first = await readSubagentActivity(file, 0, 2)
  expect(first?.items.length).toBeGreaterThanOrEqual(2)
  expect(first?.nextCursor).not.toBeNull()
  const second = await readSubagentActivity(file, first?.nextCursor ?? 0, 100)
  expect(second?.items.map(item => item.kind)).toEqual(['tool_result', 'tool_use'])
  expect(second?.nextCursor).toBeNull()
})

test('activity for a missing file is null, not an empty list', async () => {
  expect(await readSubagentActivity('/nonexistent/agent.jsonl', 0, 10)).toBeNull()
})
