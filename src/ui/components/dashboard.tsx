import { Gauge, MessageCircleQuestion, Moon, Plus, RotateCcw, Shield } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { Chat, UsageView } from '../../channel/web/protocol.ts'
import {
  busiestContext,
  dashboardCounts,
  lastEnded,
  needsYouItems,
  recentProjects,
  sessionName,
  summaryText,
  workingItems,
  type NeedsYouItem,
  type WorkingItem,
} from '../dashboard-model.ts'
import { NEEDS_YOU_BADGE_CLASS, NEEDS_YOU_TEXT_CLASS } from '../presentation.ts'
import { barWidth, formatDuration, limitTone } from '../usage-format.ts'
import { Button } from './ui/button.tsx'
import { AccountUsageStrip, BAR, TEXT, useNow } from './usage-meters.tsx'

type PromptActionBody = { promptId: string; questionIndex: number; optionIndex: number }

export type DashboardProps = {
  chats: Chat[]
  usage: UsageView
  away: boolean
  /** False while the connection is down: answering is disabled, because it would not arrive. */
  online: boolean
  onOpenChat(chatId: string, focus?: { promptId: string }): void
  onPromptAction(chatId: string, body: PromptActionBody): Promise<void>
  onToggleAway(): void
  onNewSession(): void
  onStartProject(cwd: string): Promise<void>
  onResume(chatId: string): Promise<void>
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h2 id={id} className="px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function NeedsYouCard({ item, online, now, onOpen, onAction }: { item: NeedsYouItem; online: boolean; now: number; onOpen(): void; onAction(body: PromptActionBody): Promise<void> }) {
  const [phase, setPhase] = useState<'idle' | 'allow' | 'deny' | 'failed'>('idle')
  const { prompt } = item
  const answer = (optionIndex: 0 | 1) => {
    setPhase(optionIndex === 0 ? 'allow' : 'deny')
    onAction({ promptId: prompt.promptId, questionIndex: 0, optionIndex }).catch(() => setPhase('failed'))
  }
  const busy = phase === 'allow' || phase === 'deny'
  const Icon = prompt.kind === 'permission' ? Shield : MessageCircleQuestion
  return (
    <article data-needs-you={item.chatId} className="grid gap-3 rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-border/60">
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${NEEDS_YOU_BADGE_CLASS}`}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium">{item.name}</span>
            <span className={`shrink-0 ${NEEDS_YOU_TEXT_CLASS}`}>waiting {formatDuration(now - prompt.at)}</span>
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">{prompt.summary}</p>
          {prompt.count > 1 && <p className="mt-1 text-[11px] text-muted-foreground">+{prompt.count - 1} more waiting</p>}
        </div>
      </div>
      {prompt.kind === 'permission' ? (
        <div className="flex items-center justify-end gap-2">
          {phase === 'failed' && <span role="alert" className="mr-auto text-xs text-red-700 dark:text-red-300">Could not send. Try again.</span>}
          <Button variant="ghost" size="sm" onClick={onOpen}>Open</Button>
          <Button variant="outline" size="sm" disabled={!online || busy} onClick={() => answer(1)}>
            {phase === 'deny' ? 'Denying…' : 'Deny'}
          </Button>
          <Button size="sm" disabled={!online || busy} onClick={() => answer(0)}>
            {phase === 'allow' ? 'Allowing…' : 'Allow'}
          </Button>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" onClick={onOpen}>Answer</Button>
        </div>
      )}
    </article>
  )
}

function WorkingCard({ item, now, onOpen }: { item: WorkingItem; now: number; onOpen(): void }) {
  return (
    <button
      type="button"
      data-working={item.chatId}
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-sm ring-1 ring-border/60 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-medium">{item.name}</span>
          {item.at !== null && <span className="shrink-0 text-muted-foreground">{formatDuration(now - item.at)} ago</span>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.step ?? 'Working…'}</span>
      </span>
    </button>
  )
}

function BudgetCard({ chats, usage, now }: { chats: Chat[]; usage: UsageView; now: number }) {
  const context = busiestContext(chats, usage)
  const hasAccounts = usage.accounts.length > 0
  return (
    <div className="grid gap-3 rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-border/60">
      {hasAccounts ? (
        <AccountUsageStrip accounts={usage.accounts} now={now} />
      ) : (
        <p className="text-xs text-muted-foreground">No limit data yet. It appears after a session&apos;s next turn.</p>
      )}
      {context !== null && (
        <div className="flex items-center gap-2 text-[11px]">
          <Gauge className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="shrink-0 text-muted-foreground">Fullest context</span>
          <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className={`h-full rounded-full ${BAR[limitTone(context.percent)]}`} style={{ width: `${barWidth(context.percent)}%` }} />
          </div>
          <span className={`min-w-0 truncate ${TEXT[limitTone(context.percent)]}`}>
            {Math.round(context.percent)}% · {context.name}
          </span>
        </div>
      )}
    </div>
  )
}

function ResumeLast({ chat, onResume }: { chat: Chat; onResume(): Promise<void> }) {
  // Two taps, because resuming starts Claude again; one stray tap should not.
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant={armed ? 'default' : 'outline'}
      size="sm"
      disabled={busy}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }
        setBusy(true)
        onResume().finally(() => {
          setBusy(false)
          setArmed(false)
        })
      }}
    >
      <RotateCcw aria-hidden="true" />
      <span className="truncate">{armed ? `Tap again to resume ${sessionName(chat)}` : `Resume ${sessionName(chat)}`}</span>
    </Button>
  )
}

export function Dashboard({ chats, usage, away, online, onOpenChat, onPromptAction, onToggleAway, onNewSession, onStartProject, onResume }: DashboardProps) {
  const now = useNow()
  const counts = dashboardCounts(chats)
  const needsYou = needsYouItems(chats)
  const working = workingItems(chats)
  const projects = recentProjects(chats)
  const ended = lastEnded(chats)
  return (
    <div data-dashboard className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <div className="flex items-center justify-between gap-3 rounded-2xl px-1">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight">{away ? 'Away mode on' : 'Mission control'}</h2>
            <p aria-live="polite" className={`mt-0.5 text-sm ${counts.needsYou > 0 ? `font-medium ${NEEDS_YOU_TEXT_CLASS}` : 'text-muted-foreground'}`}>
              {summaryText(counts)}
            </p>
          </div>
          <Button variant={away ? 'default' : 'outline'} size="sm" aria-pressed={away} onClick={onToggleAway}>
            <Moon aria-hidden="true" /> {away ? 'Back' : 'Away'}
          </Button>
        </div>

        {needsYou.length > 0 && (
          <Section id="dash-needs-you" title="Needs you">
            {needsYou.map(item => (
              <NeedsYouCard
                key={item.chatId}
                item={item}
                online={online}
                now={now}
                onOpen={() => onOpenChat(item.chatId, { promptId: item.prompt.promptId })}
                onAction={body => onPromptAction(item.chatId, body)}
              />
            ))}
          </Section>
        )}

        {working.length > 0 && (
          <Section id="dash-working" title="Working now">
            {working.map(item => (
              <WorkingCard key={item.chatId} item={item} now={now} onOpen={() => onOpenChat(item.chatId)} />
            ))}
          </Section>
        )}

        <Section id="dash-budget" title="Budget">
          <BudgetCard chats={chats} usage={usage} now={now} />
        </Section>

        <Section id="dash-actions" title="Quick actions">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onNewSession}>
              <Plus aria-hidden="true" /> New session
            </Button>
            {projects.map(project => (
              <Button key={project.cwd} variant="outline" size="sm" disabled={!online} title={project.cwd} onClick={() => void onStartProject(project.cwd)}>
                <Plus aria-hidden="true" /> {project.label}
              </Button>
            ))}
            {ended !== null && <ResumeLast chat={ended} onResume={() => onResume(ended.id)} />}
          </div>
        </Section>
      </div>
    </div>
  )
}
