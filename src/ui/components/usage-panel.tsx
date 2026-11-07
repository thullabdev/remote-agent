import { Gauge } from 'lucide-react'
import type { AccountUsageView, LimitView, SessionUsageView } from '../../bridge/usage.ts'
import { barWidth, formatDuration, formatResetLocal, liveAccount, limitTone } from '../usage-format.ts'
import { BAR, TEXT } from './usage-meters.tsx'

export const USAGE_PANEL_ID = 'chat-usage-panel'

export function UsageButton({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={USAGE_PANEL_ID}
      className={`inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${open ? 'bg-muted text-foreground' : 'bg-card'}`}
    >
      <Gauge className="size-3" aria-hidden="true" />
      Usage
    </button>
  )
}

function agoText(ms: number): string {
  if (ms < 60_000) {
    return 'just now'
  }
  return `${formatDuration(ms)} ago`
}

function Meter({ percent }: { percent: number }) {
  return (
    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
      <div
        className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${BAR[limitTone(percent)]}`}
        style={{ width: `${barWidth(percent)}%` }}
      />
    </div>
  )
}

function MeterRow({ label, mono, percent, detail }: { label: string; mono?: boolean; percent: number; detail: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className={`w-14 shrink-0 text-xs text-muted-foreground ${mono ? 'font-mono' : ''}`}>{label}</span>
        <Meter percent={percent} />
        <span className={`w-10 shrink-0 text-right font-mono text-xs tabular-nums ${TEXT[limitTone(percent)]}`}>{Math.round(percent)}%</span>
      </div>
      <p className="mt-0.5 min-w-0 break-words pl-16 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function WindowRow({ label, limit, now, timeZone }: { label: string; limit: LimitView | null; now: number; timeZone?: string }) {
  if (limit === null) {
    return null
  }
  const detail = `Resets ${formatResetLocal(limit.resetsAtMs, now, timeZone)} · in ${formatDuration(limit.resetsAtMs - now)}`
  return <MeterRow label={label} mono percent={limit.usedPercent} detail={detail} />
}

type UsagePanelProps = {
  open: boolean
  account: AccountUsageView
  session: SessionUsageView | undefined
  now: number
  timeZone?: string
}

export function UsagePanel({ open, account, session, now, timeZone }: UsagePanelProps) {
  if (!open) {
    return null
  }
  const live = liveAccount(account, now)
  const context = session !== undefined && session.contextPercent !== null ? session : null
  const cost = session !== undefined && session.costUsd !== null ? session.costUsd : null
  const empty = live === null && context === null && cost === null
  const readings = [live?.measuredAt, session?.measuredAt].filter((value): value is number => value !== undefined)
  const measuredAt = readings.length > 0 ? Math.max(...readings) : null
  return (
    <section id={USAGE_PANEL_ID} aria-label="Usage" className="mx-auto mb-2 max-w-4xl min-w-0 rounded-2xl border border-border bg-card px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Usage</p>
        {measuredAt !== null && !empty && <p className="truncate text-[11px] text-muted-foreground">Updated {agoText(Math.max(0, now - measuredAt))}</p>}
      </div>
      {empty ? (
        <p className="mt-2 text-xs text-muted-foreground">No usage reported yet.</p>
      ) : (
        <div className="mt-2 space-y-2.5">
          {live !== null && (
            <>
              <WindowRow label="5h" limit={live.fiveHour} now={now} timeZone={timeZone} />
              <WindowRow label="7d" limit={live.sevenDay} now={now} timeZone={timeZone} />
            </>
          )}
          {context !== null && context.contextPercent !== null && (
            <MeterRow
              label="Context"
              percent={context.contextPercent}
              detail={context.contextTokens !== null ? `${context.contextTokens.toLocaleString('en-US')} / ${context.contextWindow.toLocaleString('en-US')} tokens` : ''}
            />
          )}
          {cost !== null && <p className="text-xs text-muted-foreground">Session cost ${cost.toFixed(2)}</p>}
        </div>
      )}
    </section>
  )
}
