export type RateLimitInput = { kind: string; percentUsed: number; resetsAt?: string }
export type ContextInput = { tokens?: number; window: number; percent?: number }
export type UsageReport = { context: ContextInput; rateLimits: RateLimitInput[]; cost?: { usd: number } }

export type LimitView = { usedPercent: number; resetsAtMs: number }
export type SessionUsageView = {
  measuredAt: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
}
export type AccountUsageView = { fiveHour: LimitView | null; sevenDay: LimitView | null; measuredAt: number } | null

export function accountLimits(
  rateLimits: RateLimitInput[],
  now: number,
): Pick<NonNullable<AccountUsageView>, 'fiveHour' | 'sevenDay'> | null {
  let fiveHour: LimitView | null = null
  let sevenDay: LimitView | null = null
  for (const limit of rateLimits) {
    if (limit.kind === 'five_hour') {
      fiveHour = toLimitView(limit, now)
    }
    if (limit.kind === 'seven_day') {
      sevenDay = toLimitView(limit, now)
    }
  }
  if (fiveHour === null && sevenDay === null) {
    return null
  }
  return { fiveHour, sevenDay }
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
  return { usedPercent: limit.percentUsed, resetsAtMs }
}
