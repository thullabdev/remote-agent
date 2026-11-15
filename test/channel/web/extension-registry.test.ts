import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadExtensions } from '../../../src/channel/web/extension-registry.ts'

describe('loadExtensions', () => {
  let dir: string
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function makeExtension(id: string, invalid: boolean): void {
    const extDir = join(dir, id)
    mkdirSync(join(extDir, 'backend'), { recursive: true })
    writeFileSync(join(extDir, 'plugin.json'), invalid ? '{ not json' : JSON.stringify({ id, name: id, version: '0.1.0', frontend: { entry: './frontend/index.ts' }, backend: { entry: './backend/index.ts' }, permissions: ['pty'] }))
    writeFileSync(
      join(extDir, 'backend/index.ts'),
      `export function onActivate(api: any) { globalThis.__activated_${id.replace(/[^a-zA-Z0-9]/g, '_')} = true }`
    )
  }

  function activatedId(id: string): string {
    return `__activated_${id.replace(/[^a-zA-Z0-9]/g, '_')}`
  }

  it('loads a manifest from a temp extensions dir and calls onActivate', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ra-ext-test-'))
    const id = 'remote-agent.test-ext'
    makeExtension(id, false)
    ;(globalThis as any)[activatedId(id)] = false

    const instances = await loadExtensions(dir, { api: createApi(), log: () => {} })

    expect(instances.length).toBe(1)
    const instance = instances[0]
    expect(instance).toBeDefined()
    expect(instance!.manifest.id).toBe(id)
    expect((globalThis as any)[activatedId(id)]).toBe(true)
  })

  it('skips an extension whose manifest fails validation, logging the error', async () => {
    dir = mkdtempSync(join(tmpdir(), 'ra-ext-test-'))
    makeExtension('remote-agent.bad-ext', true)

    const instances = await loadExtensions(dir, { api: createApi(), log: () => {} })

    expect(instances.length).toBe(0)
  })
})

function createApi() {
  return {
    frontend: { registerPanel: () => {} },
    backend: { registerHttpRoute: () => {}, registerWebSocketRoute: () => {} },
    log: () => {},
  }
}
