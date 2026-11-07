import { describe, expect, test } from 'bun:test'
import { authHeaders, buildRows, formatAgo, renderRows, type ChatSummary } from '../../scripts/bridge-status.ts'

function chat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    title: 'project · 1a2b3c4d',
    status: 'active',
    spawned: false,
    busy: false,
    unread: 0,
    tmuxName: null,
    lastMessage: null,
    ...overrides,
  }
}

describe('authHeaders', () => {
  test('uses the bearer token when one is set', () => {
    expect(authHeaders({ REMOTE_AGENT_WEB_TOKEN: 'secret', REMOTE_AGENT_WEB_ALLOWED_LOGIN: 'me@x' })).toEqual({
      'Sec-Fetch-Site': 'same-origin',
      Authorization: 'Bearer secret',
    })
  })
  test('uses the allowed login when there is no token', () => {
    expect(authHeaders({ REMOTE_AGENT_WEB_ALLOWED_LOGIN: 'me@x' })).toEqual({
      'Sec-Fetch-Site': 'same-origin',
      'Tailscale-User-Login': 'me@x',
    })
  })
  test('refuses to run without any identity', () => {
    expect(() => authHeaders({})).toThrow('REMOTE_AGENT_WEB_ALLOWED_LOGIN')
  })
})

describe('buildRows', () => {
  test('leaves out the General chat', () => {
    const rows = buildRows([chat({ id: 'general', title: 'General' }), chat({ id: 'c_1' })], new Map())
    expect(rows.map(row => row.title)).toEqual(['project · 1a2b3c4d'])
  })
  test('counts only pending prompts', () => {
    const messages = [
      { kind: 'prompt', status: 'pending' },
      { kind: 'prompt', status: 'answered' },
      { kind: 'agent_text' },
      { kind: 'prompt', status: 'pending' },
    ]
    const [row] = buildRows([chat({ id: 'c_1' })], new Map([['c_1', messages]]))
    expect(row?.pending).toBe(2)
  })
  test('leaves out ended sessions unless asked to include them', () => {
    const chats = [chat({ id: 'c_1' }), chat({ id: 'c_2', status: 'ended' })]
    expect(buildRows(chats, new Map()).map(row => row.state)).toEqual(['active'])
    expect(buildRows(chats, new Map(), { includeEnded: true }).map(row => row.state)).toEqual(['active', 'ended'])
  })
  test('offers an attach command only for active spawned sessions', () => {
    const rows = buildRows(
      [
        chat({ id: 'c_1', spawned: true, tmuxName: 'ra-1a2b3c4d' }),
        chat({ id: 'c_2', spawned: true, tmuxName: 'ra-2b2b2b2b', status: 'ended' }),
        chat({ id: 'c_3', spawned: false }),
      ],
      new Map(),
      { includeEnded: true },
    )
    expect(rows.map(row => row.attach)).toEqual(['tmux attach -t ra-1a2b3c4d', null, null])
  })
})

describe('formatAgo', () => {
  const now = 10_000_000
  test('reports seconds, minutes, hours and days', () => {
    expect(formatAgo(now - 30_000, now)).toBe('30s ago')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe('3d ago')
  })
  test('shows a dash when there was no activity', () => {
    expect(formatAgo(null, now)).toBe('-')
  })
})

describe('renderRows', () => {
  test('says so when there are no sessions', () => {
    expect(renderRows([], 0)).toBe('No sessions.')
  })
  test('prints a header, one line per session, and attach hints', () => {
    const now = 1_000_000
    const output = renderRows(
      buildRows(
        [chat({ id: 'c_1', spawned: true, tmuxName: 'ra-1a2b3c4d', busy: true, unread: 2, lastMessage: { seq: 5, at: now - 60_000, preview: '' } })],
        new Map([['c_1', [{ kind: 'prompt', status: 'pending' }]]]),
      ),
      now,
    )
    const lines = output.split('\n')
    expect(lines[0]).toMatch(/^SESSION\s+STATE\s+BUSY\s+PENDING\s+UNREAD\s+SPAWNED\s+LAST ACTIVITY$/)
    expect(lines[1]).toMatch(/^project · 1a2b3c4d\s+active\s+yes\s+1\s+2\s+yes\s+1m ago$/)
    expect(output).toContain('tmux attach -t ra-1a2b3c4d')
  })
})
