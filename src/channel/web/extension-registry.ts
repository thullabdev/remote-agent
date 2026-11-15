import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createExtensionApi, scopeRegistrar, validatePluginManifest, type ExtensionApi, type ExtensionManifest, type ExtensionRouteRegistrar } from '../../extension-sdk/index.ts'
import { Log } from '../../bridge/prompts.ts'
import type { ExtensionMigration, ExtensionStorageHost } from './extension-storage.ts'

/** A loaded extension instance. `onActivate` has already been called. */
export type ExtensionInstance = {
  manifest: ExtensionManifest
  deactivate(): void
}

/** Options for loading extensions. Storage is optional; an extension that asks for it fails without it. */
export type LoadExtensionsOptions = {
  registrar: ExtensionRouteRegistrar
  storage?: ExtensionStorageHost
  log: Log
}

/**
 * Scans `extensionDir` for extension folders, validates each `plugin.json`, prepares its storage (declared collections and
 * pending migrations), loads the backend entry, and calls `onActivate(api)`. Failures are logged and the extension is skipped;
 * startup never aborts because of a single bad extension.
 */
export async function loadExtensions(extensionDir: string, options: LoadExtensionsOptions): Promise<ExtensionInstance[]> {
  const { registrar, storage, log } = options
  const instances: ExtensionInstance[] = []

  let entries: string[]
  try {
    entries = readdirSync(extensionDir)
  } catch {
    // No extensions directory: not an error.
    return instances
  }

  for (const entry of entries) {
    const extDir = join(extensionDir, entry)
    if (!statSync(extDir).isDirectory()) {
      continue
    }

    try {
      const manifest = loadManifest(extDir)
      const backendEntry = await loadBackendEntry(extDir, manifest.backend.entry)
      const migrations = backendEntry.migrations ?? []
      const wantsStorage = manifest.permissions.includes('storage')
      if (!wantsStorage && migrations.length > 0) {
        throw new Error(`${manifest.id} ships migrations but does not request the storage permission`)
      }
      if (wantsStorage && storage === undefined) {
        throw new Error(`${manifest.id} requests storage, but this host has no storage`)
      }
      if (wantsStorage && storage !== undefined) {
        storage.prepare(manifest, migrations)
      }
      const api: ExtensionApi = createExtensionApi(scopeRegistrar(manifest.id, registrar), {
        storage: wantsStorage && storage !== undefined ? storage.storageFor(manifest) : undefined,
      })
      const deactivate = backendEntry.onActivate?.(api) ?? (() => {})
      instances.push({ manifest, deactivate })
      log(`extension loaded: ${manifest.id} v${manifest.version}`)
    } catch (error) {
      log(`extension failed to load: ${entry}`, error)
    }
  }

  return instances
}

function loadManifest(extDir: string): ExtensionManifest {
  const manifestPath = join(extDir, 'plugin.json')
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return validatePluginManifest(raw)
}

type BackendModule = {
  onActivate?: (api: ExtensionApi) => (() => void) | void
  migrations?: ExtensionMigration[]
}

async function loadBackendEntry(extDir: string, entry: string): Promise<BackendModule> {
  const entryPath = join(extDir, entry)
  const mod = await import(entryPath)
  return mod
}
