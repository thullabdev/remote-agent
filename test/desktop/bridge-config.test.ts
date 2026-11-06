import { expect, test } from 'bun:test'
import { readBridgeConfig } from '../../apps/desktop/bridge-config.mjs'

test('desktop defaults to managing its own Bridge', () => {
  expect(readBridgeConfig({})).toEqual({ mode: 'managed' })
})

test('existing mode requires a URL but allows service-provided authentication', () => {
  expect(() => readBridgeConfig({ REMOTE_AGENT_DESKTOP_BRIDGE_MODE: 'existing' })).toThrow(
    'REMOTE_AGENT_DESKTOP_BRIDGE_URL is required in existing mode.',
  )
  expect(readBridgeConfig({
    REMOTE_AGENT_DESKTOP_BRIDGE_MODE: 'existing',
    REMOTE_AGENT_DESKTOP_BRIDGE_URL: 'http://127.0.0.1:8787',
  })).toEqual({ mode: 'existing', origin: 'http://127.0.0.1:8787', token: null })
})

test('existing mode normalizes the configured service origin', () => {
  expect(readBridgeConfig({
    REMOTE_AGENT_DESKTOP_BRIDGE_MODE: 'existing',
    REMOTE_AGENT_DESKTOP_BRIDGE_URL: 'https://agent.example.test/',
    REMOTE_AGENT_DESKTOP_BRIDGE_TOKEN: 'bridge-token',
  })).toEqual({
    mode: 'existing',
    origin: 'https://agent.example.test',
    token: 'bridge-token',
  })
})

test('existing mode rejects URLs that are not plain HTTP origins', () => {
  for (const url of [
    'file:///tmp/app',
    'http://user:password@localhost:8787',
    'http://localhost:8787/app',
    'http://localhost:8787/?token=secret',
  ]) {
    expect(() => readBridgeConfig({
      REMOTE_AGENT_DESKTOP_BRIDGE_MODE: 'existing',
      REMOTE_AGENT_DESKTOP_BRIDGE_URL: url,
      REMOTE_AGENT_DESKTOP_BRIDGE_TOKEN: 'bridge-token',
    })).toThrow('REMOTE_AGENT_DESKTOP_BRIDGE_URL must be an http(s) origin with no path, query, or credentials.')
  }
})
