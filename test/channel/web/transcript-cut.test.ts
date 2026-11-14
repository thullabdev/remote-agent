import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cutTranscript, TranscriptCutError } from '../../../src/channel/web/transcript/cut.ts'

async function setup(lines: object[]): Promise<{ source: string; destination: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'cut-'))
  const source = join(dir, 'orig.jsonl')
  await writeFile(source, lines.map(line => JSON.stringify(line)).join('\n') + '\n')
  return { source, destination: join(dir, 'fork.jsonl') }
}

const transcript = [
  { uuid: 'u1', sessionId: 'orig', type: 'user' },
  { uuid: 'a1', sessionId: 'orig', type: 'assistant' },
  { uuid: 'u2', sessionId: 'orig', type: 'user' },
  { uuid: 'a2', sessionId: 'orig', type: 'assistant' },
]

test('cuts after the chosen uuid and rewrites the session id on every copied line', async () => {
  const { source, destination } = await setup(transcript)

  await cutTranscript({ source, destination, uuid: 'a1', sessionId: 'fork' })

  const lines = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(lines.map(line => line.uuid).slice(0, 2)).toEqual(['u1', 'a1'])
  expect(lines.every(line => line.sessionId === 'fork')).toBe(true)
})

test('a line without a sessionId field is copied as it is', async () => {
  const { source, destination } = await setup([{ uuid: 'u1', type: 'user' }, { uuid: 'a1', type: 'assistant' }])

  await cutTranscript({ source, destination, uuid: 'a1', sessionId: 'fork' })

  const lines = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(lines.slice(0, 2)).toEqual([{ uuid: 'u1', type: 'user' }, { uuid: 'a1', type: 'assistant' }])
  expect(lines[2]).toMatchObject({ type: 'user', message: { content: '[Request interrupted by user]' } })
})

test('an unknown uuid throws TranscriptCutError and writes nothing', async () => {
  const { source, destination } = await setup(transcript)

  await expect(cutTranscript({ source, destination, uuid: 'missing', sessionId: 'fork' })).rejects.toBeInstanceOf(TranscriptCutError)
  expect(existsSync(destination)).toBe(false)
})

test('a missing source file throws TranscriptCutError', async () => {
  const { destination } = await setup([])

  await expect(cutTranscript({ source: join(tmpdir(), 'no-such-transcript.jsonl'), destination, uuid: 'a1', sessionId: 'fork' })).rejects.toBeInstanceOf(
    TranscriptCutError,
  )
})

test('keeps the system lines that close the chosen reply\'s turn, and nothing from the next turn', async () => {
  const { source, destination } = await setup([
    { uuid: 'u1', sessionId: 'orig', type: 'user' },
    { uuid: 'a1', sessionId: 'orig', type: 'assistant' },
    { uuid: 'h1', sessionId: 'orig', type: 'system', subtype: 'stop_hook_summary' },
    { uuid: 'd1', sessionId: 'orig', type: 'system', subtype: 'turn_duration' },
    { uuid: 'u2', sessionId: 'orig', type: 'user' },
  ])

  await cutTranscript({ source, destination, uuid: 'a1', sessionId: 'fork' })

  const lines = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(lines.map(line => line.uuid)).toEqual(['u1', 'a1', 'h1', 'd1'])
})

test('rewrites session_id as well as sessionId', async () => {
  const { source, destination } = await setup([
    { uuid: 'u1', session_id: 'orig', type: 'user' },
    { uuid: 'a1', session_id: 'orig', type: 'assistant' },
  ])

  await cutTranscript({ source, destination, uuid: 'a1', sessionId: 'fork' })

  const lines = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(lines.every(line => line.session_id === 'fork')).toBe(true)
})

test('creates the destination folder when it does not exist yet', async () => {
  const { source } = await setup(transcript)
  const destination = join(tmpdir(), `cut-missing-${Date.now()}`, 'nested', 'fork.jsonl')

  await cutTranscript({ source, destination, uuid: 'a1', sessionId: 'fork' })

  expect(existsSync(destination)).toBe(true)
})

test('a reply that does not close its turn gets the interrupt marker, so the copy opens idle', async () => {
  const { source, destination } = await setup([
    { uuid: 'u1', sessionId: 'orig', type: 'user', message: { role: 'user', content: 'go' } },
    { uuid: 'a1', sessionId: 'orig', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }] } },
    { uuid: 'a2', sessionId: 'orig', type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1' }] } },
  ])

  await cutTranscript({ source, destination, uuid: 'a1', sessionId: 'fork' })

  const lines = (await readFile(destination, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(lines.map(line => line.uuid).slice(0, 2)).toEqual(['u1', 'a1'])
  expect(lines).toHaveLength(3)
  expect(lines[2]).toMatchObject({ type: 'user', sessionId: 'fork', message: { role: 'user', content: '[Request interrupted by user]' } })
})
