import { z } from 'zod'
import type { CollectionSpec, ExtensionStorage } from './storage.ts'
import { assertIndexType, assertValidCollectionName, assertValidField } from './storage.ts'

/** Permissions the host currently grants to extensions. Unknown values are rejected. */
export type ExtensionPermission = 'pty' | 'websocket-routes' | 'http-routes' | 'storage'

/** An extension manifest, one per extension folder under `extensions/`. */
export type ExtensionManifest = {
  id: string
  name: string
  version: string
  frontend: { entry: string }
  backend: { entry: string }
  permissions: ExtensionPermission[]
  /** Collections the extension stores documents in. Needs the `storage` permission. */
  storage: { collections: Record<string, CollectionSpec> }
}

/** Capabilities exposed to an extension's frontend code. Filled in by the host at load time. */
export type ExtensionFrontendApi = {
  /** Registers a panel component contributed by this extension. */
  registerPanel(panelId: string, component: React.ComponentType<any>, title: string): void
}

/** Capabilities exposed to an extension's backend code. Filled in by the host at load time. */
export type ExtensionBackendApi = {
  /** Key/value storage and declared collections. Present only when the manifest grants `storage`. */
  storage?: ExtensionStorage
  /** Registers an HTTP route namespaced under this extension's id. */
  registerHttpRoute(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    handler: (request: Request) => Promise<Response | null>
  ): void
  /** Registers a WebSocket route namespaced under this extension's id. */
  registerWebSocketRoute(
    path: string,
    handlers: { open?: (ws: object) => void; message?: (ws: object, raw: string | Buffer) => void; close?: (ws: object) => void }
  ): void
}

/** The host-provided API passed to an extension's `onActivate`. */
export type ExtensionApi = {
  frontend: ExtensionFrontendApi
  backend: ExtensionBackendApi
}

/** Callbacks the host uses to wire extension-registered routes into the web server. */
export type ExtensionRouteRegistrar = {
  onHttpRoute(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: (request: Request) => Promise<Response | null>): void
  onWebSocketRoute(path: string, handlers: { open?: (ws: object) => void; message?: (ws: object, raw: string | Buffer) => void; close?: (ws: object) => void }): void
  onFrontendPanel(panelId: string, component: React.ComponentType, title: string): void
}

/**
 * Namespaces an extension's backend routes under `/api/extensions/<extensionId>`, so extensions cannot collide with each
 * other or with the host's own routes. The registrar underneath still sees full paths.
 */
export function scopeRegistrar(extensionId: string, base: ExtensionRouteRegistrar): ExtensionRouteRegistrar {
  const prefix = `/api/extensions/${extensionId}`
  return {
    onHttpRoute: (method, path, handler) => {
      base.onHttpRoute(method, `${prefix}${path}`, handler)
    },
    onWebSocketRoute: (path, handlers) => {
      base.onWebSocketRoute(`${prefix}${path}`, handlers)
    },
    onFrontendPanel: (panelId, component, title) => {
      base.onFrontendPanel(panelId, component, title)
    },
  }
}

/** Creates the extension API surface. The host injects route registration via `registrar`. */
export function createExtensionApi(registrar: ExtensionRouteRegistrar, options: { storage?: ExtensionStorage } = {}): ExtensionApi {
  return {
    frontend: {
      registerPanel: (panelId, component, title) => {
        registrar.onFrontendPanel(panelId, component, title)
      },
    },
    backend: {
      storage: options.storage,
      registerHttpRoute: (method, path, handler) => {
        registrar.onHttpRoute(method, path, handler)
      },
      registerWebSocketRoute: (path, handlers) => {
        registrar.onWebSocketRoute(path, handlers)
      },
    },
  }
}

/** Manifest schema: only known permissions are allowed, entries must be relative paths. */
const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  frontend: z.object({ entry: z.string().min(1) }),
  backend: z.object({ entry: z.string().min(1) }),
  permissions: z.array(z.enum(['pty', 'websocket-routes', 'http-routes', 'storage'])).default([]),
  storage: z
    .object({
      collections: z.record(z.string(), z.object({ indexes: z.record(z.string(), z.string()).default({}) })).default({}),
    })
    .default({ collections: {} }),
})

/** Validates and normalizes a raw manifest object. Throws on invalid input. */
export function validatePluginManifest(raw: unknown): ExtensionManifest {
  const manifest = ManifestSchema.parse(raw)
  const collections = Object.entries(manifest.storage.collections)
  if (collections.length > 0 && !manifest.permissions.includes('storage')) {
    throw new Error(`${manifest.id} declares collections but does not request the storage permission`)
  }
  const checked: Record<string, CollectionSpec> = {}
  for (const [name, spec] of collections) {
    assertValidCollectionName(name)
    const indexes: CollectionSpec['indexes'] = {}
    for (const [field, type] of Object.entries(spec.indexes)) {
      assertValidField(field)
      assertIndexType(type, field)
      indexes[field] = type
    }
    checked[name] = { indexes }
  }
  return { ...manifest, storage: { collections: checked } } as ExtensionManifest
}
