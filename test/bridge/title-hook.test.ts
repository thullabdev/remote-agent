import { expect, test } from 'bun:test'
import { parseTitleInput } from '../../mod/remote-agent/bin/title-hook.ts'

test('parses a hook payload that carries a session title', () => {
  const raw = JSON.stringify({ session_id: 's1', cwd: '/home/u/app', session_title: 'fix login' })
  expect(parseTitleInput(raw)).toEqual({ session: { sessionId: 's1', cwd: '/home/u/app' }, title: 'fix login' })
})

test('ignores payloads without a usable title', () => {
  expect(parseTitleInput('not json')).toBeNull()
  expect(parseTitleInput(JSON.stringify({ session_id: 's1', cwd: '/x' }))).toBeNull()
  expect(parseTitleInput(JSON.stringify({ session_id: 's1', cwd: '/x', session_title: '  ' }))).toBeNull()
})
