import { describe, expect, test } from 'bun:test'

// register.ts imports the 'claude-code' types, which tsconfig excludes it for. Load it by a computed path so the typecheck does not follow it.
const registerPath = '../../mod/remote-agent/hooks/register.ts'
const { register } = (await import(registerPath)) as { register: (on: never) => void }

type Handler = (...args: any[]) => Promise<unknown>

function measureHandler(): Handler {
  let found: Handler | undefined
  const on = (name: string, ...rest: unknown[]) => {
    if (name === 'session.measure') {
      found = rest.at(-1) as Handler
    }
  }
  register(on as never)
  if (found === undefined) {
    throw new Error('session.measure not registered')
  }
  return found
}

const event = { context: { window: 200_000, tokens: 1000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 10 }], cost: { usd: 0.5 }, changed: ['context'] }

function fakeEngine(fetch: (url: string, init: any) => Promise<unknown>) {
  return {
    env: { get: async (name: string) => (name === 'HOME' ? '/home/test' : undefined) },
    session: { id: async () => 's1', cwd: async () => '/p' },
    http: { fetch },
  } as never
}

describe('session.measure', () => {
  test('posts the event figures to the bridge /usage and passes the event on', async () => {
    const posts: { url: string; body: any }[] = []
    const $ = fakeEngine(async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) })
      return { status: 202, text: '' }
    })
    let nextCalls = 0
    const next = async (e: unknown) => {
      nextCalls += 1
      return e
    }
    await measureHandler()($, event, next)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(nextCalls).toBe(1)
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe('http://bridge/usage')
    expect(posts[0]!.body).toEqual({
      session: { sessionId: 's1', cwd: '/p' },
      usage: { context: event.context, rateLimits: event.rateLimits, cost: event.cost },
    })
  })

  test('a failing bridge post is swallowed and next is still called once', async () => {
    const $ = fakeEngine(async () => {
      throw new Error('ECONNREFUSED')
    })
    let nextCalls = 0
    const next = async (e: unknown) => {
      nextCalls += 1
      return e
    }
    await expect(measureHandler()($, event, next)).resolves.toBe(event)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(nextCalls).toBe(1)
  })

  test('a failing engine lookup is swallowed too', async () => {
    const $ = { env: { get: async () => { throw new Error('boom') } }, session: {}, http: {} } as never
    let nextCalls = 0
    await expect(measureHandler()($, event, async (e: unknown) => { nextCalls += 1; return e })).resolves.toBe(event)
    expect(nextCalls).toBe(1)
  })
})
