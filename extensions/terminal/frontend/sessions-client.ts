/** The terminal extension's HTTP routes, under the host's /api/extensions/<id>/ prefix. */
export const TERMINAL_API = '/api/extensions/remote-agent.terminal'

/** A stored session as the server lists it. */
export type SessionView = {
  sid: string
  cwd: string
  project: string
  chatId: string | null
  createdAt: number
  lastAttachedAt: number | null
  /** True while a browser has this session open. */
  attached: boolean
}

type Fetch = typeof fetch

export class TerminalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function failure(response: Response): Promise<TerminalApiError> {
  let message = `request failed (${response.status})`
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') {
      message = body.error
    }
  } catch {
    // Not JSON: keep the status message.
  }
  return new TerminalApiError(message, response.status)
}

/** The caller's open sessions, newest first. */
export async function listSessions(fetcher: Fetch = fetch): Promise<SessionView[]> {
  const response = await fetcher(`${TERMINAL_API}/sessions`, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw await failure(response)
  }
  return ((await response.json()) as { sessions: SessionView[] }).sessions
}

/** Starts a shell in `cwd` (home when omitted), linked to a chat when given. The server returns the session id. */
export async function createSession(input: { cwd?: string; chatId?: string | null }, fetcher: Fetch = fetch): Promise<{ sid: string; cwd: string; createdAt: number }> {
  const response = await fetcher(`${TERMINAL_API}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw await failure(response)
  }
  return (await response.json()) as { sid: string; cwd: string; createdAt: number }
}

/** Ends a session: its shell is killed. */
export async function closeSession(sid: string, fetcher: Fetch = fetch): Promise<void> {
  const response = await fetcher(`${TERMINAL_API}/sessions/close`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sid }),
  })
  if (!response.ok) {
    throw await failure(response)
  }
}
