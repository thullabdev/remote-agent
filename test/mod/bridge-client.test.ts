import { expect, test } from 'bun:test'
import { BridgeClient, BridgeError, type HttpPort } from '../../mod/remote-agent/hooks/bridge-client.ts'

function recording(responses: { status: number; text: string }[]) {
  const calls: { path: string; method?: string; body?: string }[] = []
  const http: HttpPort = async (path, init) => {
    calls.push({ path, method: init?.method, body: init?.body })
    const next = responses.shift()
    if (next === undefined) {
      throw new Error('no response queued')
    }
    return next
  }
  return { calls, client: new BridgeClient(http) }
}

test('createPrompt posts JSON and parses the state', async () => {
  const { calls, client } = recording([{ status: 200, text: '{"status":"pending"}' }])
  const state = await client.createPrompt({ promptId: 'p:1', session: { sessionId: 's', cwd: '/' }, body: { kind: 'permission', tool: 'Bash', input: {} } })
  expect(state).toEqual({ status: 'pending' })
  expect(calls[0]).toMatchObject({ path: '/prompts', method: 'POST' })
  expect(JSON.parse(calls[0]!.body!)).toMatchObject({ promptId: 'p:1' })
})

test('waitAnswer encodes the id and passes waitMs', async () => {
  const { calls, client } = recording([{ status: 200, text: '{"status":"pending"}' }])
  await client.waitAnswer('p:1', 20_000)
  expect(calls[0]!.path).toBe('/prompts/p%3A1?waitMs=20000')
})

test('empty-bodied endpoints resolve without parsing', async () => {
  const { client } = recording([{ status: 202, text: '' }, { status: 204, text: '' }])
  await client.report({ session: { sessionId: 's', cwd: '/' }, report: { kind: 'session_started' } })
  await client.ackInstruction('i1')
})

test('http errors and transport failures become BridgeError', async () => {
  const { client } = recording([{ status: 404, text: '' }])
  await expect(client.waitAnswer('x', 0)).rejects.toBeInstanceOf(BridgeError)
  const broken = new BridgeClient(async () => {
    throw new Error('ECONNREFUSED')
  })
  await expect(broken.instructions('s')).rejects.toBeInstanceOf(BridgeError)
})

test('settled posts the scope to the session', async () => {
  const { calls, client } = recording([{ status: 200, text: '{"settled":1}' }])
  await client.settled('s 1', { kind: 'all' })
  expect(calls[0]).toMatchObject({ path: '/sessions/s%201/settled', method: 'POST' })
  expect(JSON.parse(calls[0]!.body!)).toEqual({ scope: { kind: 'all' } })
})
