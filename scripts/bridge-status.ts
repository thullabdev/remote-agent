// Lists the Bridge's sessions with their state and pending prompts, read from the web API on loopback.
// `remote-agent.sh status` runs this after it has loaded ~/.config/remote-agent/env.

export type ChatSummary = {
  id: string
  title: string
  status: 'active' | 'ended'
  spawned: boolean
  busy: boolean
  unread: number
  tmuxName: string | null
  lastMessage: { seq: number; at: number; preview: string } | null
}

export type MessageSummary = { kind: string; status?: string }

export type SessionRow = {
  title: string
  state: 'active' | 'ended'
  busy: boolean
  pending: number
  unread: number
  spawned: boolean
  attach: string | null
  lastActivity: number | null
}

export function authHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' }
  const token = env.REMOTE_AGENT_WEB_TOKEN
  const login = env.REMOTE_AGENT_WEB_ALLOWED_LOGIN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  } else if (login) {
    headers['Tailscale-User-Login'] = login
  } else {
    throw new Error('Set REMOTE_AGENT_WEB_ALLOWED_LOGIN (or REMOTE_AGENT_WEB_TOKEN) in the env file')
  }
  return headers
}

export type RowOptions = { includeEnded: boolean }

/**
 * One row per session. The General chat is the command surface, not a session, so it is left out.
 * Ended sessions are left out unless `includeEnded` is set.
 */
export function buildRows(
  chats: ChatSummary[],
  messagesByChat: Map<string, MessageSummary[]>,
  options: RowOptions = { includeEnded: false },
): SessionRow[] {
  return chats
    .filter(chat => chat.id !== 'general')
    .filter(chat => options.includeEnded || chat.status === 'active')
    .map(chat => {
      const messages = messagesByChat.get(chat.id) ?? []
      const pending = messages.filter(message => message.kind === 'prompt' && message.status === 'pending').length
      const attachable = chat.spawned && chat.status === 'active' && chat.tmuxName !== null
      return {
        title: chat.title,
        state: chat.status,
        busy: chat.busy,
        pending,
        unread: chat.unread,
        spawned: chat.spawned,
        attach: attachable ? `tmux attach -t ${chat.tmuxName}` : null,
        lastActivity: chat.lastMessage?.at ?? null,
      }
    })
}

export function formatAgo(at: number | null, now: number): string {
  if (at === null) {
    return '-'
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 48) {
    return `${hours}h ago`
  }
  return `${Math.round(hours / 24)}d ago`
}

export function renderRows(rows: SessionRow[], now: number): string {
  if (rows.length === 0) {
    return 'No sessions.'
  }
  const header = ['SESSION', 'STATE', 'BUSY', 'PENDING', 'UNREAD', 'SPAWNED', 'LAST ACTIVITY']
  const body = rows.map(row => [
    row.title,
    row.state,
    row.busy ? 'yes' : 'no',
    String(row.pending),
    String(row.unread),
    row.spawned ? 'yes' : 'no',
    formatAgo(row.lastActivity, now),
  ])
  const table = [header, ...body]
  const widths = header.map((_, column) => Math.max(...table.map(line => (line[column] ?? '').length)))
  const lines = table.map(line => line.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd())
  const attach = rows.filter(row => row.attach !== null).map(row => `  ${row.title}: ${row.attach}`)
  return attach.length > 0 ? [...lines, '', 'Attach to a spawned session:', ...attach].join('\n') : lines.join('\n')
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  if (!response.ok) {
    throw new Error(`${new URL(url).pathname} answered ${response.status}`)
  }
  return (await response.json()) as T
}

async function main(): Promise<void> {
  const port = process.env.REMOTE_AGENT_WEB_PORT ?? '8787'
  const base = `http://127.0.0.1:${port}/api`
  const headers = authHeaders(process.env)

  const state = await getJson<{ away: boolean; chats: ChatSummary[] }>(`${base}/state`, headers)
  const active = state.chats.filter(chat => chat.id !== 'general' && chat.status === 'active')
  const messagesByChat = new Map<string, MessageSummary[]>()
  await Promise.all(
    active.map(async chat => {
      const page = await getJson<{ messages: MessageSummary[] }>(
        `${base}/chats/${encodeURIComponent(chat.id)}/messages`,
        headers,
      )
      messagesByChat.set(chat.id, page.messages)
    }),
  )

  const includeEnded = process.argv.includes('--all')
  const now = Date.now()
  const rows = buildRows(state.chats, messagesByChat, { includeEnded })
  const label = includeEnded ? 'session(s), ended included' : 'active session(s), use --all to include ended ones'
  console.log(`Away mode ${state.away ? 'on' : 'off'} · ${rows.length} ${label} · pending counts cover each session's latest 50 messages`)
  console.log('')
  console.log(renderRows(rows, now))
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Could not read the Bridge API: ${message}`)
    process.exit(1)
  })
}
