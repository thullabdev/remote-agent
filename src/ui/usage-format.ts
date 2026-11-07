import type { AccountUsageView, LimitView, SessionUsageView } from '../core/usage-types.ts'

export type Tone = 'green' | 'yellow' | 'red'

// "45m", "2h 10m", "3d 4h". Anything at or below zero reads as "now".
export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return 'now'
  }
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${Math.max(minutes, 1)}m`
}

// "14:30" for a window of a day or less, "Mon 09:00" for a longer one. timeZone defaults to the local zone.
export function formatResetClock(resetsAtMs: number, windowMinutes: number, timeZone?: string): string {
  const date = new Date(resetsAtMs)
  const clock = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  if (windowMinutes <= 1440) {
    return clock
  }
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone })
  return `${weekday} ${clock}`
}

// "2% · resets 14:00 (in 4h 0m)"
export function formatLimitText(limit: LimitView, now: number, timeZone?: string): string {
  const remaining = formatDuration(limit.resetsAtMs - now)
  const clock = formatResetClock(limit.resetsAtMs, limit.windowMinutes, timeZone)
  return `${Math.round(limit.usedPercent)}% · resets ${clock} (in ${remaining})`
}

// "ctx 42%", or null when the percent is unknown so the surface can hide.
export function formatContextText(view: SessionUsageView): string | null {
  if (view.contextPercent === null) {
    return null
  }
  return `ctx ${Math.round(view.contextPercent)}%`
}

// Same thresholds as the status line: green under 50, yellow under 80, red otherwise.
export function limitTone(percent: number): Tone {
  if (percent < 50) {
    return 'green'
  }
  if (percent < 80) {
    return 'yellow'
  }
  return 'red'
}

export function barWidth(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)))
}

// A window whose reset time has passed is stale: treat it as absent. Null when no window is live.
export function liveWindows(account: AccountUsageView, now: number): AccountUsageView | null {
  const windows = account.windows.filter(window => window.resetsAtMs > now)
  if (windows.length === 0) {
    return null
  }
  return { ...account, windows }
}

// The accounts that still have a live window, each trimmed to its live windows.
export function liveAccounts(accounts: AccountUsageView[], now: number): AccountUsageView[] {
  const live: AccountUsageView[] = []
  for (const account of accounts) {
    const trimmed = liveWindows(account, now)
    if (trimmed !== null) {
      live.push(trimmed)
    }
  }
  return live
}

// "today 14:00" when the reset falls on the same calendar day as `now`, otherwise "Tue 08:00".
// Days are compared in `timeZone` (default: the browser's local zone).
export function formatResetLocal(resetsAtMs: number, now: number, timeZone?: string): string {
  const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone })
  const clock = new Date(resetsAtMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  if (dayKey(resetsAtMs) === dayKey(now)) {
    return `today ${clock}`
  }
  const weekday = new Date(resetsAtMs).toLocaleDateString('en-US', { weekday: 'short', timeZone })
  return `${weekday} ${clock}`
}
