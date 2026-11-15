import { describe, it, expect } from 'bun:test'
import { validatePluginManifest, type ExtensionManifest } from '../../src/extension-sdk/index.ts'

describe('validatePluginManifest', () => {
  it('accepts a valid terminal manifest', () => {
    const manifest = validatePluginManifest({
      id: 'remote-agent.terminal',
      name: 'Terminal',
      version: '0.1.0',
      frontend: { entry: './frontend/index.ts' },
      backend: { entry: './backend/index.ts' },
      permissions: ['pty', 'websocket-routes'],
    })
    expect(manifest.id).toBe('remote-agent.terminal')
    expect(manifest.permissions).toContain('pty')
  })

  it('rejects a missing id', () => {
    expect(() => validatePluginManifest({ name: 'x', version: '0.1.0' } as any)).toThrow()
  })

  it('rejects unknown permissions', () => {
    expect(() =>
      validatePluginManifest({
        id: 'x',
        name: 'x',
        version: '0.1.0',
        frontend: { entry: './f.ts' },
        backend: { entry: './b.ts' },
        permissions: ['pty', 'forbidden-thing'],
      } as any)
    ).toThrow()
  })
})
