import { describe, it, expect } from 'bun:test'
import { closeSession, createSession, listSessions, TerminalApiError, TERMINAL_API } from './sessions-client.ts'

function fakeFetch(respond: (url: string, init?: RequestInit) => Response, calls: Array<{ url: string; init?: RequestInit }> = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    return respond(url, init)
  }) as typeof fetch
}

describe('terminal sessions client', () => {
  it('lists sessions from the extension route', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const sessions = await listSessions(fakeFetch(() => Response.json({ sessions: [{ sid: 'term-1', cwd: '/a' }] }), calls))

    expect(sessions).toEqual([{ sid: 'term-1', cwd: '/a' }] as any)
    expect(calls[0]?.url).toBe(`${TERMINAL_API}/sessions`)
  })

  it('creates a session with the folder and chat, and returns the server id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const created = await createSession({ cwd: '/work/app', chatId: 'chat-1' }, fakeFetch(() => Response.json({ sid: 'term-9', cwd: '/work/app', createdAt: 5 }, { status: 201 }), calls))

    expect(created.sid).toBe('term-9')
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ cwd: '/work/app', chatId: 'chat-1' })
  })

  it('surfaces the server message when creating fails', async () => {
    const error = await createSession({ cwd: '/nope' }, fakeFetch(() => Response.json({ error: 'folder does not exist: /nope' }, { status: 400 }))).catch(e => e)

    expect(error).toBeInstanceOf(TerminalApiError)
    expect((error as TerminalApiError).message).toBe('folder does not exist: /nope')
    expect((error as TerminalApiError).status).toBe(400)
  })

  it('closes a session by id in the body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    await closeSession('term-9', fakeFetch(() => Response.json({ ok: true }), calls))

    expect(calls[0]?.url).toBe(`${TERMINAL_API}/sessions/close`)
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ sid: 'term-9' })
  })
})
