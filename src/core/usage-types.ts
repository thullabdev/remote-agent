export type LimitView = { kind: string; label: string; windowMinutes: number; usedPercent: number; resetsAtMs: number }
export type AccountUsageView = { source: string; windows: LimitView[]; measuredAt: number }
export type SessionUsageView = {
  measuredAt: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
}
export type UsageView = { accounts: AccountUsageView[]; chats: Record<string, SessionUsageView> }
