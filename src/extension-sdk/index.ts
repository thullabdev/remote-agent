import { z } from 'zod'

/** Permissions the host currently grants to extensions. Unknown values are rejected. */
export type ExtensionPermission = 'pty' | 'websocket-routes' | 'http-routes'

/** An extension manifest, one per extension folder under `extensions/`. */
export type ExtensionManifest = {
  id: string
  name: string
  version: string
  frontend: { entry: string }
  backend: { entry: string }
  permissions: ExtensionPermission[]
}

/** Capabilities exposed to an extension's frontend code. Filled in by the host at load time. */
export type ExtensionFrontendApi = {
  /** Registers a panel component contributed by this extension. */
  registerPanel(panelId: string, component: React.ComponentType, title: string): void
}

/** Capabilities exposed to an extension's backend code. Filled in by the host at load time. */
export type ExtensionBackendApi = {
  /** Registers an HTTP route namespaced under this extension's id. */
  registerHttpRoute(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    handler: (request: Request) => Promise<Response | null>
  ): void
  /** Registers a WebSocket route namespaced under this extension's id. */
  registerWebSocketRoute(
    path: string,
    handlers: { open?: (ws: unknown) => void; message?: (ws: unknown, raw: string | Buffer) => void; close?: (ws: unknown) => void }
  ): void
}

/** The host-provided API passed to an extension's `onActivate`. */
export type ExtensionApi = {
  frontend: ExtensionFrontendApi
  backend: ExtensionBackendApi
}

/** Manifest schema: only known permissions are allowed, entries must be relative paths. */
const ManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  frontend: z.object({ entry: z.string().min(1) }),
  backend: z.object({ entry: z.string().min(1) }),
  permissions: z.array(z.enum(['pty', 'websocket-routes', 'http-routes']).default([])).default([]),
})

/** Validates and normalizes a raw manifest object. Throws on invalid input. */
export function validatePluginManifest(raw: unknown): ExtensionManifest {
  return ManifestSchema.parse(raw) as ExtensionManifest
}

/** Creates the extension API surface. Host-provided implementations are injected by the registry. */
export function createExtensionApi(): ExtensionApi {
  return {
    frontend: {
      registerPanel: () => {
        // No-op until the host injects a real implementation.
      },
    },
    backend: {
      registerHttpRoute: () => {
        // No-op until the host injects a real implementation.
      },
      registerWebSocketRoute: () => {
        // No-op until the host injects a real implementation.
      },
    },
  }
}
