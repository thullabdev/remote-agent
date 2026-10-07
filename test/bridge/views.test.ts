import { expect, test } from 'bun:test'
import { SETTLED_LOCALLY_MESSAGE } from '../../mod/remote-agent/hooks/protocol.ts'
import type { PromptRow, SessionRow } from '../../src/bridge/store.ts'
import { formatDuration, permissionSummary, promptView, reportText, resolutionNote, threadTitle } from '../../src/bridge/views.ts'

const session: SessionRow = { id: 'abcdef1234567890', cwd: '/home/u/app', project: 'app', threadId: null, title: null, endedAt: null, spawned: false, tmuxName: null, startedAt: null }

function prompt(body: PromptRow['body']): PromptRow {
  return { id: 'q:toolu_1', sessionId: session.id, body, status: 'pending', answer: null, source: null, partial: {}, createdAt: 0, reminded: false }
}

test('thread title is project plus short session id', () => {
  expect(threadTitle(session)).toBe('app · abcdef12')
})

test('permission view has Allow and Deny buttons and a redacted summary', () => {
  const view = promptView(prompt({ kind: 'permission', tool: 'Bash', input: { command: 'curl -H "Authorization: x" API_KEY=s3cret' } }), session)
  expect(view.title).toBe('app · abcdef12')
  expect(view.items).toHaveLength(1)
  const item = view.items[0]!
  expect(item.text).toContain('🔐 Permission: Bash')
  expect(item.text).toContain('API_KEY=[REDACTED]')
  expect(item.text).not.toContain('s3cret')
  expect(item.buttons.map(button => button.label)).toEqual(['✅ Allow', '❌ Deny'])
  expect(item.buttons[1]!.data).toEqual({ promptId: 'q:toolu_1', questionIndex: 0, optionIndex: 1 })
})

test('question view: buttons for single-select, reply hint for multi-select', () => {
  const view = promptView(
    prompt({
      kind: 'question',
      questions: [
        { question: 'Which DB?', header: 'Storage', multiSelect: false, options: [{ label: 'SQLite', description: 'embedded' }, { label: 'Postgres', description: '' }] },
        { question: 'Which extras?', header: 'Extras', multiSelect: true, options: [{ label: 'Docs', description: '' }, { label: 'Tests', description: '' }] },
      ],
    }),
    session,
  )
  expect(view.items).toHaveLength(2)
  expect(view.items[0]!.text).toContain('1. SQLite — embedded')
  expect(view.items[0]!.buttons.map(button => button.data)).toEqual([
    { promptId: 'q:toolu_1', questionIndex: 0, optionIndex: 0 },
    { promptId: 'q:toolu_1', questionIndex: 0, optionIndex: 1 },
  ])
  expect(view.items[1]!.buttons).toEqual([])
  expect(view.items[1]!.text).toContain('Reply to this message with option numbers')
})

test('permission summary picks the meaningful field per tool', () => {
  expect(permissionSummary('Bash', { command: 'ls -la' })).toBe('$ ls -la')
  expect(permissionSummary('Write', { file_path: '/a.ts', content: 'x' })).toBe('/a.ts\nx')
  expect(permissionSummary('Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' })).toBe('/a.ts\n--- old\na\n+++ new\nb')
  expect(permissionSummary('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev')
  expect(permissionSummary('mcp__x__y', { a: 1 })).toBe('{\n  "a": 1\n}')
})

test('permission summary truncates huge input', () => {
  expect(permissionSummary('Bash', { command: 'x'.repeat(10_000) }).length).toBeLessThan(1_600)
})

test('report texts', () => {
  expect(reportText({ kind: 'session_started' }, session)).toBe('🟢 Session started in /home/u/app')
  expect(reportText({ kind: 'session_ended', reason: 'exit' }, session)).toBe('⚪ Session ended (exit)')
  expect(reportText({ kind: 'turn_complete', text: 'Done.', durationMs: 75_000, isAborted: false }, session)).toBe('✅ Turn finished after 1m 15s\n\nDone.')
  expect(reportText({ kind: 'turn_complete', text: '', durationMs: 5_000, isAborted: true }, session)).toBe('⛔ Turn interrupted after 5s')
})

test('resolution notes', () => {
  expect(resolutionNote({ kind: 'permission', decision: 'allow' }, 'local')).toBe('✅ Allowed (local)')
  expect(resolutionNote({ kind: 'permission', decision: 'deny', message: 'use pnpm' }, 'remote')).toBe('❌ Denied (remote): use pnpm')
  expect(resolutionNote({ kind: 'question', answers: { 'A?': 'x', 'B?': 'y' } }, 'remote')).toBe('✅ Answered (remote): x / y')
  expect(resolutionNote({ kind: 'question', answers: {} }, 'local')).toBe('🚫 Dismissed (local)')
})

test('durations', () => {
  expect(formatDuration(999)).toBe('0s')
  expect(formatDuration(59_000)).toBe('59s')
  expect(formatDuration(3_725_000)).toBe('62m 5s')
})

test('cwd, reason and option labels are redacted and bounded', () => {
  expect(reportText({ kind: 'session_started' }, { ...session, cwd: '/srv/app?token=abc123' })).toBe('🟢 Session started in /srv/app?token=[REDACTED]')
  expect(reportText({ kind: 'session_ended', reason: 'password=hunter2' }, session)).toBe('⚪ Session ended (password=[REDACTED])')
  const view = promptView(
    prompt({ kind: 'question', questions: [{ question: 'q', header: 'h', multiSelect: false, options: [{ label: 'x'.repeat(100), description: '' }] }] }),
    session,
  )
  expect(view.items[0]!.buttons[0]!.label.length).toBeLessThan(90)
})

test('a prompt settled in the terminal is reported as such, not as an allow or deny', () => {
  expect(resolutionNote({ kind: 'permission', decision: 'allow', message: SETTLED_LOCALLY_MESSAGE }, 'local')).toBe('☑️ Answered in the terminal')
  expect(resolutionNote({ kind: 'permission', decision: 'deny', message: SETTLED_LOCALLY_MESSAGE }, 'local')).toBe('☑️ Answered in the terminal')
})

test('thread title appends the session name, collapsed and truncated to 128 characters', () => {
  expect(threadTitle({ ...session, title: 'fix  the\nlogin bug' })).toBe('app · abcdef12 · fix the login bug')
  expect(threadTitle({ ...session, title: '   ' })).toBe('app · abcdef12')
  const long = threadTitle({ ...session, title: 'x'.repeat(300) })
  expect(long).toHaveLength(128)
  expect(long.startsWith('app · abcdef12 · xxx')).toBe(true)
  expect(long.endsWith('…')).toBe(true)
})
