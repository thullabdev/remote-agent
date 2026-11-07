import type { AccountUsageView, LimitView, SessionUsageView } from '../bridge/usage.ts'

export type LimitWindow = '5h' | '7d'
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

// "14:30" for the 5h window, "Mon 09:00" for the 7d window. timeZone defaults to the local zone.
export function formatResetClock(resetsAtMs: number, window: LimitWindow, timeZone?: string): string {
  const date = new Date(resetsAtMs)
  const clock = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
  if (window === '5h') {
    return clock
  }
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone })
  return `${weekday} ${clock}`
}

// "2% · resets 14:00 (in 4h 0m)"
export function formatLimitText(limit: LimitView, now: number, window: LimitWindow = '5h', timeZone?: string): string {
  const remaining = formatDuration(limit.resetsAtMs - now)
  const clock = formatResetClock(limit.resetsAtMs, window, timeZone)
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

// A window whose reset time has passed is stale: treat it as absent. Null when neither window is live.
export function liveAccount(account: AccountUsageView, now: number): NonNullable<AccountUsageView> | null {
  if (account === null) {
    return null
  }
  const fiveHour = account.fiveHour !== null && account.fiveHour.resetsAtMs > now ? account.fiveHour : null
  const sevenDay = account.sevenDay !== null && account.sevenDay.resetsAtMs > now ? account.sevenDay : null
  if (fiveHour === null && sevenDay === null) {
    return null
  }
  return { ...account, fiveHour, sevenDay }
}
