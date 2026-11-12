import { expect, test } from 'bun:test'
import { parseModelInput } from '../../mod/remote-agent/bin/model-hook.ts'

test('parses a PostModelSwitch payload into the session and the model it now runs on', () => {
  const raw = JSON.stringify({ session_id: 's1', cwd: '/home/u/app', from_model: 'claude-sonnet-5-5', to_model: 'claude-opus-5-5', source: 'command' })
  expect(parseModelInput(raw)).toEqual({ session: { sessionId: 's1', cwd: '/home/u/app' }, model: 'claude-opus-5-5' })
})

test('ignores payloads without a session or a model', () => {
  expect(parseModelInput('not json')).toBeNull()
  expect(parseModelInput(JSON.stringify({ session_id: 's1', cwd: '/x' }))).toBeNull()
  expect(parseModelInput(JSON.stringify({ session_id: '', cwd: '/x', to_model: 'claude-opus-5-5' }))).toBeNull()
})
