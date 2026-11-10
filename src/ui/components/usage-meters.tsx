import { useEffect, useState } from 'react'
import type { AccountUsageView, LimitView, SessionUsageView } from '../../core/usage-types.ts'
import { barWidth, formatContextText, formatLimitText, limitTone, liveAccounts, type Tone } from '../usage-format.ts'

export const BAR: Record<Tone, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-red-500' }
export const TEXT: Record<Tone, string> = {
  green: 'text-emerald-700 dark:text-emerald-300',
  yellow: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
}

function LimitRow({ limit, now, timeZone }: { limit: LimitView; now: number; timeZone?: string }) {
  const tone = limitTone(limit.usedPercent)
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-5 shrink-0 font-mono text-muted-foreground">{limit.label}</span>
      <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${barWidth(limit.usedPercent)}%` }} />
      </div>
      <span className={`min-w-0 truncate ${TEXT[tone]}`}>{formatLimitText(limit, now, timeZone)}</span>
    </div>
  )
}

type StripProps = { accounts: AccountUsageView[]; now: number; timeZone?: string; className?: string }

// One block of rows per source with a live window; a source heading is shown only when there are several.
export function AccountUsageStrip({ accounts, now, timeZone, className = '' }: StripProps) {
  const live = liveAccounts(accounts, now)
  if (live.length === 0) {
    return null
  }
  return (
    <div className={`space-y-1 ${className}`} aria-label="Account usage limits">
      {live.map(account => (
        <div key={account.source} className="space-y-1">
          {live.length > 1 && <p className="text-[10px] font-medium text-muted-foreground">{account.source}</p>}
          {account.windows.map(limit => (
            <LimitRow key={limit.kind} limit={limit} now={now} timeZone={timeZone} />
          ))}
        </div>
      ))}
    </div>
  )
}

// The details-panel section: always rendered, with a muted empty state when no window is live.
export function AccountLimitsSection({ accounts, now, timeZone }: { accounts: AccountUsageView[]; now: number; timeZone?: string }) {
  const empty = liveAccounts(accounts, now).length === 0
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Account limits</p>
      {empty ? (
        <p className="mt-1 text-xs text-muted-foreground">No limit data yet. It appears after a session&apos;s next turn.</p>
      ) : (
        <AccountUsageStrip accounts={accounts} now={now} timeZone={timeZone} className="mt-1" />
      )}
    </div>
  )
}

// Wall clock that re-renders every `intervalMs`, so "in 4h 0m" counts down between usage updates.
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
