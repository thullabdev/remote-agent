import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtensionApi, ExtensionManifest } from '../../extension-sdk/index.ts'
import { validatePluginManifest } from '../../extension-sdk/index.ts'
import { Log } from '../../bridge/prompts.ts'

/** A loaded extension instance. `onActivate` has already been called. */
export type ExtensionInstance = {
  manifest: ExtensionManifest
  deactivate(): void
}

/** Options for loading extensions. */
export type LoadExtensionsOptions = {
  api: ExtensionApi
  log: Log
  now?: () => number
}

/**
 * Scans `extensionDir` for extension folders, validates each `plugin.json`, loads the backend
 * entry, and calls `onActivate(api)`. Failures are logged and the extension is skipped; startup
 * never aborts because of a single bad extension.
 */
export async function loadExtensions(extensionDir: string, options: LoadExtensionsOptions): Promise<ExtensionInstance[]> {
  const { api, log } = options
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

async function loadBackendEntry(extDir: string, entry: string): Promise<{ onActivate?: (api: ExtensionApi) => (() => void) | void }> {
  const entryPath = join(extDir, entry)
  const mod = await import(entryPath)
  return mod
}
