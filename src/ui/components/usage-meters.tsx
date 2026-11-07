import { useEffect, useState } from 'react'
import type { AccountUsageView, SessionUsageView } from '../../bridge/usage.ts'
import { barWidth, formatContextText, liveAccount, formatLimitText, limitTone, type LimitWindow, type Tone } from '../usage-format.ts'

const BAR: Record<Tone, string> = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-red-500' }
const TEXT: Record<Tone, string> = {
  green: 'text-emerald-700 dark:text-emerald-300',
  yellow: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
}

type LimitRowProps = { label: string; window: LimitWindow; limit: NonNullable<AccountUsageView>['fiveHour']; now: number; timeZone?: string }

function LimitRow({ label, window, limit, now, timeZone }: LimitRowProps) {
  if (limit === null) {
    return null
  }
  const tone = limitTone(limit.usedPercent)
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-5 shrink-0 font-mono text-muted-foreground">{label}</span>
      <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted" role="presentation">
        <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${barWidth(limit.usedPercent)}%` }} />
      </div>
      <span className={`min-w-0 truncate ${TEXT[tone]}`}>{formatLimitText(limit, now, window, timeZone)}</span>
    </div>
  )
}

export function AccountUsageStrip({ account, now, timeZone, className = '' }: { account: AccountUsageView; now: number; timeZone?: string; className?: string }) {
  const live = liveAccount(account, now)
  if (live === null) {
    return null
  }
  return (
    <div className={`space-y-1 ${className}`} aria-label="Account usage limits">
      <LimitRow label="5h" window="5h" limit={live.fiveHour} now={now} timeZone={timeZone} />
      <LimitRow label="7d" window="7d" limit={live.sevenDay} now={now} timeZone={timeZone} />
    </div>
  )
}

export function ContextPill({ view }: { view: SessionUsageView | undefined }) {
  if (view === undefined) {
    return null
  }
  const text = formatContextText(view)
  if (text === null || view.contextPercent === null) {
    return null
  }
  return (
    <span className={`inline-flex items-center rounded-full border border-border px-2 py-0 font-mono text-[10px] ${TEXT[limitTone(view.contextPercent)]}`} title="Context window used">
      {text}
    </span>
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
