import { describe, expect, test } from 'bun:test'
import { createApiClient, RequestError } from '../../src/ui/api.ts'

describe('Web Channel API client', () => {
  test('sends JSON content type even when a chat action has no body', async () => {
    let request: { url: string; method: string; headers: HeadersInit } | undefined
    const client = createApiClient(async (input, init) => {
      request = { url: input, method: init?.method ?? 'GET', headers: init?.headers ?? {} }
      return Response.json({ ok: true })
    })

    await client.clearChat('c/with spaces')

    expect(request?.url).toBe('/api/chats/c%2Fwith%20spaces/clear')
    expect(request?.method).toBe('POST')
    expect(new Headers(request?.headers).get('Content-Type')).toBe('application/json')
  })

  test('distinguishes an authorization failure from the server content-type error', async () => {
    const unauthorized = createApiClient(async () => Response.json({ error: 'missing identity' }, { status: 401 }))
    const missingContentType = createApiClient(async () =>
      Response.json({ error: 'content type must be application/json' }, { status: 403 }),
    )

    await expect(unauthorized.getState()).rejects.toMatchObject({
      name: 'RequestError',
      status: 401,
      accessDenied: true,
    })
    await expect(missingContentType.getState()).rejects.toBeInstanceOf(RequestError)
    await expect(missingContentType.getState()).rejects.toMatchObject({
      status: 403,
      accessDenied: false,
    })
  })

  test('posts an idempotency key and preserves the message returned by the Bridge', async () => {
    let request: { url: string; init?: RequestInit } | undefined
    const message = {
      id: 'm_1',
      chatId: 'general',
      seq: 4,
      at: 100,
      kind: 'user_text',
      text: '/status',
      status: 'delivered',
      instructionId: null,
    } as const
    const client = createApiClient(async (input, init) => {
      request = { url: input, init }
      return Response.json({ message })
    })

    await expect(client.sendMessage('general', { clientId: 'retry-1', text: '/status' })).resolves.toEqual({ message })
    expect(request?.init?.body).toBe(JSON.stringify({ clientId: 'retry-1', text: '/status' }))
  })

  test('covers the documented read, prompt, Session, project, away, and push routes', async () => {
    const calls: { url: string; method: string; contentType: string | null }[] = []
    const client = createApiClient(async (url, init) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        contentType: new Headers(init?.headers).get('Content-Type'),
      })
      return Response.json({})
    })

    await client.getState()
    await client.getMessages('c/1', 42)
    await client.sendMessage('c/1', { clientId: '1', text: 'hello' })
    await client.performAction('c/1', { promptId: 'p/1', questionIndex: 0, optionIndex: 1 })
    await client.replyToPrompt('p/1', { questionIndex: 0, text: 'details' })
    await client.markRead('c/1', 42)
    await client.setAway(true)
    await client.endChat('c/1')
    await client.archiveChat('c/1')
    await client.unarchiveChat('c/1')
    await client.clearChat('c/1')
    await client.forkChat('c/1')
    await client.resumeChat('c/1')
    await client.getProjects()
    await client.startProject({ cwd: '/trusted/project', model: 'model-name' })
    await client.getPushKey()
    await client.subscribePush({ endpoint: 'https://push.example/subscription', keys: { p256dh: 'public', auth: 'secret' } })
    await client.unsubscribePush('https://push.example/subscription')

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET /api/state',
      'GET /api/chats/c%2F1/messages?before=42',
      'POST /api/chats/c%2F1/messages',
      'POST /api/chats/c%2F1/actions',
      'POST /api/prompts/p%2F1/reply',
      'POST /api/chats/c%2F1/read',
      'PUT /api/away',
      'POST /api/chats/c%2F1/end',
      'POST /api/chats/c%2F1/archive',
      'POST /api/chats/c%2F1/unarchive',
      'POST /api/chats/c%2F1/clear',
      'POST /api/chats/c%2F1/fork',
      'POST /api/chats/c%2F1/resume',
      'GET /api/projects',
      'POST /api/projects/start',
      'GET /api/push/key',
      'POST /api/push/subscriptions',
      'DELETE /api/push/subscriptions',
    ])
    expect(calls.filter(call => call.method !== 'GET').every(call => call.contentType === 'application/json')).toBe(true)
  })
})
