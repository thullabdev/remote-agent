import { expect, test } from 'bun:test'
import { defaultSocketPath, projectName } from '../../mod/remote-agent/hooks/protocol.ts'

test('socket lives under XDG_RUNTIME_DIR when set', () => {
  expect(defaultSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000', HOME: '/home/u' })).toBe('/run/user/1000/remote-agent/bridge.sock')
})

test('socket falls back to HOME state dir', () => {
  expect(defaultSocketPath({ HOME: '/home/u' })).toBe('/home/u/.local/state/remote-agent/bridge.sock')
})

test('socket path needs XDG_RUNTIME_DIR or HOME', () => {
  expect(() => defaultSocketPath({})).toThrow('XDG_RUNTIME_DIR')
})

test('project name is the last path segment', () => {
  expect(projectName('/home/u/Sites/remote-agent')).toBe('remote-agent')
  expect(projectName('/home/u/Sites/remote-agent/')).toBe('remote-agent')
  expect(projectName('/')).toBe('/')
})
