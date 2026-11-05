import { expect, test } from 'bun:test'
import { claudeCodeAdapter, type AgentAdapter } from '../../src/bridge/agent-adapter.ts'
import { Launcher } from '../../src/bridge/launcher.ts'
import { FakeTmux } from '../support/fake-tmux.ts'

const id = '3f2a9c1b-0000-4000-8000-000000000000'
const resumed = '9b1c2d3e-0000-4000-8000-000000000000'

test('claude-code adapter starts a new session with its own id', () => {
  expect(claudeCodeAdapter.name).toBe('claude-code')
  expect(claudeCodeAdapter.launchArgv({ sessionId: id, cwd: '/x' })).toEqual(['claude', '--session-id', id])
})

test('claude-code adapter forks a transcript into a new id by default', () => {
  expect(claudeCodeAdapter.launchArgv({ sessionId: id, cwd: '/x', resumeFrom: resumed })).toEqual(['claude', '--resume', resumed, '--fork-session', '--session-id', id])
})

test('claude-code adapter resumes in place when fork is false', () => {
  expect(claudeCodeAdapter.launchArgv({ sessionId: id, cwd: '/x', resumeFrom: id, fork: false })).toEqual(['claude', '--resume', id])
})

test('claude-code adapter appends --model last when a model is given', () => {
  expect(claudeCodeAdapter.launchArgv({ sessionId: id, cwd: '/x', model: 'opus' })).toEqual(['claude', '--session-id', id, '--model', 'opus'])
  expect(claudeCodeAdapter.launchArgv({ sessionId: id, cwd: '/x', model: null })).toEqual(['claude', '--session-id', id])
})

test('the launcher runs whatever argv the injected adapter returns inside tmux', async () => {
  const tmux = new FakeTmux()
  const other: AgentAdapter = { name: 'fake', launchArgv: spec => ['fake-agent', '--id', spec.sessionId] }
  await new Launcher(tmux.run, other).launch({ sessionId: id, cwd: '/x' })
  expect(tmux.calls[0]?.slice(-3)).toEqual(['fake-agent', '--id', id])
  expect(tmux.calls[0]).not.toContain('claude')
})
