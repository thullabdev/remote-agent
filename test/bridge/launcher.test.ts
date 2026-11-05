import { beforeEach, expect, test } from 'bun:test'
import { LaunchError, Launcher, runCommand, tmuxNameFor } from '../../src/bridge/launcher.ts'
import { FakeTmux } from '../support/fake-tmux.ts'

const id = '3f2a9c1b-0000-4000-8000-000000000000'
let tmux: FakeTmux
let launcher: Launcher

beforeEach(() => {
  tmux = new FakeTmux()
  launcher = new Launcher(tmux.run)
})

test('tmux names use the first 8 characters of the session id', () => {
  expect(tmuxNameFor(id)).toBe('ra-3f2a9c1b')
})

test('launch runs claude in a detached tmux session in its own systemd scope', async () => {
  expect(await launcher.launch({ sessionId: id, cwd: '/home/u/Sites/My Projects/app' })).toEqual({ tmuxName: 'ra-3f2a9c1b' })
  expect(tmux.calls[0]).toEqual([
    'env', '-u', 'TELEGRAM_BOT_TOKEN', '-u', 'TELEGRAM_CHAT_ID', '-u', 'TELEGRAM_ALLOWED_USER_ID',
    'systemd-run', '--user', '--scope', '--quiet', '--collect',
    'tmux', 'new-session', '-d', '-s', 'ra-3f2a9c1b', '-c', '/home/u/Sites/My Projects/app',
    'claude', '--session-id', id,
  ])
})

test('launch passes --model to claude when a model is given', async () => {
  await launcher.launch({ sessionId: id, cwd: '/x', model: 'opus' })
  expect(tmux.calls[0]?.slice(-5)).toEqual(['claude', '--session-id', id, '--model', 'opus'])
})

test('launch with resumeFrom resumes that transcript into a new session id', async () => {
  const resumed = '9b1c2d3e-0000-4000-8000-000000000000'
  await launcher.launch({ sessionId: id, cwd: '/x', resumeFrom: resumed })
  expect(tmux.calls[0]?.slice(-6)).toEqual(['claude', '--resume', resumed, '--fork-session', '--session-id', id])
})

test('launch can resume the same Claude session without forking or assigning a new id', async () => {
  await launcher.launch({ sessionId: id, cwd: '/x', resumeFrom: id, fork: false })
  expect(tmux.calls[0]?.slice(-3)).toEqual(['claude', '--resume', id])
  expect(tmux.calls[0]).not.toContain('--fork-session')
  expect(tmux.calls[0]).not.toContain('--session-id')
})

test('launch with resumeFrom and a model passes both', async () => {
  const resumed = '9b1c2d3e-0000-4000-8000-000000000000'
  await launcher.launch({ sessionId: id, cwd: '/x', resumeFrom: resumed, model: 'haiku' })
  expect(tmux.calls[0]?.slice(-8)).toEqual(['claude', '--resume', resumed, '--fork-session', '--session-id', id, '--model', 'haiku'])
})

test('a failed launch throws a redacted LaunchError', async () => {
  tmux.launchFails = 'Failed to connect to bus: token=abcdef123456'
  const failure = launcher.launch({ sessionId: id, cwd: '/x' })
  await expect(failure).rejects.toBeInstanceOf(LaunchError)
  await expect(failure).rejects.toThrow('token=[REDACTED]')
})

test('launch refuses a session id or resume id that could read as a flag, before starting anything', async () => {
  const resumed = '9b1c2d3e-0000-4000-8000-000000000000'
  await expect(launcher.launch({ sessionId: '--help', cwd: '/x' })).rejects.toBeInstanceOf(LaunchError)
  await expect(launcher.launch({ sessionId: '-x', cwd: '/x' })).rejects.toBeInstanceOf(LaunchError)
  await expect(launcher.launch({ sessionId: 'has space', cwd: '/x' })).rejects.toBeInstanceOf(LaunchError)
  await expect(launcher.launch({ sessionId: '', cwd: '/x' })).rejects.toBeInstanceOf(LaunchError)
  await expect(launcher.launch({ sessionId: id, cwd: '/x', resumeFrom: '--dangerous' })).rejects.toBeInstanceOf(LaunchError)
  await expect(launcher.launch({ sessionId: id, cwd: '/x', resumeFrom: resumed })).resolves.toEqual({ tmuxName: 'ra-3f2a9c1b' })
  expect(tmux.calls.length).toBe(1)
})

test('launch accepts short ids such as s1', async () => {
  expect(await launcher.launch({ sessionId: 's1', cwd: '/x' })).toEqual({ tmuxName: 'ra-s1' })
})

test('exists, sendExit, kill and capture address the exact session', async () => {
  tmux.alive.add('ra-3f2a9c1b')
  tmux.screen = 'one\ntwo\nthree\n\n\n'
  expect(await launcher.exists('ra-3f2a9c1b')).toBe(true)
  expect(await launcher.capture('ra-3f2a9c1b', 2)).toBe('two\nthree')
  await launcher.sendExit('ra-3f2a9c1b')
  expect(await launcher.exists('ra-3f2a9c1b')).toBe(false)
  expect(tmux.calls).toEqual([
    ['tmux', 'has-session', '-t', '=ra-3f2a9c1b'],
    ['tmux', 'capture-pane', '-p', '-t', 'ra-3f2a9c1b'],
    ['tmux', 'send-keys', '-t', 'ra-3f2a9c1b', '/exit', 'Enter'],
    ['tmux', 'has-session', '-t', '=ra-3f2a9c1b'],
  ])
})

test('kill tolerates a session that is already gone', async () => {
  await launcher.kill('ra-gone')
  expect(tmux.calls).toEqual([['tmux', 'kill-session', '-t', '=ra-gone']])
})

test('runCommand reports a missing executable instead of throwing', async () => {
  const result = await runCommand(['/nonexistent/definitely-not-here'])
  expect(result.code).not.toBe(0)
  expect(result.stderr).not.toBe('')
})
