import { Gauge } from 'lucide-react'
import type { AccountUsageView, LimitView, SessionUsageView } from '../../core/usage-types.ts'
import { barWidth, formatContextText, formatDuration, formatResetLocal, limitTone, liveAccounts } from '../usage-format.ts'
import { BAR, TEXT } from './usage-meters.tsx'

export const USAGE_PANEL_ID = 'chat-usage-panel'

/** The header's usage control: "ctx 42%" when the session reported its context, else just a gauge. Tapping it opens the panel. */
export function UsageToggle({ view, open, onToggle }: { view: SessionUsageView | undefined; open: boolean; onToggle(): void }) {
  const text = view === undefined ? null : formatContextText(view)
  const percent = view === undefined ? null : view.contextPercent
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={USAGE_PANEL_ID}
      aria-label={text === null ? 'Usage' : `Usage, ${text}`}
      title="Usage and limits"
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 font-mono text-[10px] transition-colors hover:bg-muted ${
        percent === null ? 'text-muted-foreground' : TEXT[limitTone(percent)]
      } ${open ? 'bg-muted' : ''}`}
    >
      <Gauge className="size-3.5" aria-hidden="true" />
      {text !== null && <span>{text}</span>}
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

function WindowRow({ limit, now, timeZone }: { limit: LimitView; now: number; timeZone?: string }) {
  const detail = `Resets ${formatResetLocal(limit.resetsAtMs, now, timeZone)} · in ${formatDuration(limit.resetsAtMs - now)}`
  return <MeterRow label={limit.label} mono percent={limit.usedPercent} detail={detail} />
}

type UsagePanelProps = {
  open: boolean
  accounts: AccountUsageView[]
  session: SessionUsageView | undefined
  now: number
  timeZone?: string
  className?: string
}

export function UsagePanel({ open, accounts, session, now, timeZone, className = 'mx-auto mb-2 max-w-4xl' }: UsagePanelProps) {
  if (!open) {
    return null
  }
  const live = liveAccounts(accounts, now)
  const context = session !== undefined && session.contextPercent !== null ? session : null
  const cost = session !== undefined && session.costUsd !== null ? session.costUsd : null
  const empty = live.length === 0 && context === null && cost === null
  const readings = [...live.map(account => account.measuredAt), session?.measuredAt].filter((value): value is number => value !== undefined)
  const measuredAt = readings.length > 0 ? Math.max(...readings) : null
  return (
    <section id={USAGE_PANEL_ID} aria-label="Usage" className={`min-w-0 rounded-2xl bg-card px-3 py-2.5 shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Usage</p>
        {measuredAt !== null && !empty && <p className="truncate text-[11px] text-muted-foreground">Updated {agoText(Math.max(0, now - measuredAt))}</p>}
      </div>
      {empty ? (
        <p className="mt-2 text-xs text-muted-foreground">No usage reported yet.</p>
      ) : (
        <div className="mt-2 space-y-2.5">
          {live.map(account => (
            <div key={account.source} className="space-y-2.5">
              {live.length > 1 && <p className="text-[11px] font-medium text-muted-foreground">{account.source}</p>}
              {account.windows.map(limit => (
                <WindowRow key={limit.kind} limit={limit} now={now} timeZone={timeZone} />
              ))}
            </div>
          ))}
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
