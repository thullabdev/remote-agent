export type DesktopBridgeConfig =
  | { mode: 'managed' }
  | { mode: 'existing'; origin: string; token: string | null }

export function readBridgeConfig(env: Record<string, string | undefined>): DesktopBridgeConfig
