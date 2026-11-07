import type { LimitView, SessionUsageView } from '../core/usage-types.ts'

export type RateLimitInput = { kind: string; percentUsed: number; resetsAt?: string }
export type ContextInput = { tokens?: number; window: number; percent?: number }
export type UsageReport = { context: ContextInput; rateLimits: RateLimitInput[]; cost?: { usd: number } }

const KNOWN_WINDOWS: Record<string, { label: string; windowMinutes: number }> = {
  five_hour: { label: '5h', windowMinutes: 300 },
  seven_day: { label: '7d', windowMinutes: 10080 },
}

// Live windows only, in report order. Unknown kinds (such as spend_limit) are dropped.
export function accountLimits(rateLimits: RateLimitInput[], now: number): LimitView[] {
  // Among valid live entries, a later one of the same kind replaces an earlier one, so each kind appears once.
  const byKind = new Map<string, LimitView>()
  for (const limit of rateLimits) {
    const view = toLimitView(limit, now)
    if (view !== null) {
      byKind.delete(limit.kind)
      byKind.set(limit.kind, view)
    }
  }
  return [...byKind.values()]
}

export function sessionUsage(report: UsageReport, now: number): SessionUsageView {
  return {
    measuredAt: now,
    contextPercent: report.context.percent ?? null,
    contextTokens: report.context.tokens ?? null,
    contextWindow: report.context.window,
    costUsd: report.cost?.usd ?? null,
  }
}

function toLimitView(limit: RateLimitInput, now: number): LimitView | null {
  const known = KNOWN_WINDOWS[limit.kind]
  if (known === undefined) {
    return null
  }
  if (!Number.isFinite(limit.percentUsed)) {
    return null
  }
  if (limit.resetsAt === undefined) {
    return null
  }
  const resetsAtMs = Date.parse(limit.resetsAt)
  if (!Number.isFinite(resetsAtMs) || resetsAtMs <= now) {
    return null
  }
  return { kind: limit.kind, label: known.label, windowMinutes: known.windowMinutes, usedPercent: limit.percentUsed, resetsAtMs }
}
