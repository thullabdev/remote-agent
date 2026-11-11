import { CircleCheck, Gauge, MessageCircleQuestion, Moon, Plus, Power, RotateCcw, Shield } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { ActivityView, Chat, UsageView } from '../../channel/web/protocol.ts'
import {
  activityDescription,
  busiestContext,
  dashboardCounts,
  eventVerb,
  lastActivityAt,
  projectTiles,
  type ProjectTile,
  formatWorked,
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
  /** Loads the Today card and the activity feed. Absent hides both. */
  loadActivity?(): Promise<ActivityView>
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
    <section aria-labelledby={id} className="grid min-w-0 gap-2">
      <h2 id={id} className="px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** The project, small, above the session's title. Hidden when the project is missing or is the title already. */
function ProjectLine({ item }: { item: { project: string | null; title: string } }) {
  if (item.project === null || item.project === item.title) {
    return null
  }
  return <span className="block truncate text-[11px] text-muted-foreground">{item.project}</span>
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
          <ProjectLine item={item} />
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium">{item.title}</span>
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
      className="flex w-full min-w-0 items-center gap-3 rounded-2xl bg-card p-3.5 text-left shadow-sm ring-1 ring-border/60 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
      </span>
      <span className="min-w-0 flex-1">
        <ProjectLine item={item} />
        <span className="flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate font-medium">{item.title}</span>
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

/** Reloads the numbers now, every minute, and whenever the mix of sessions changes (a turn ending shows up at once). */
function useActivity(load: (() => Promise<ActivityView>) | undefined, signature: string): { view: ActivityView | null; failed: boolean } {
  const [view, setView] = useState<ActivityView | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(value => value + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (load === undefined) {
      return
    }
    let current = true
    load().then(
      result => {
        if (current) {
          setView(result)
          setFailed(false)
        }
      },
      () => {
        if (current) {
          setFailed(true)
        }
      },
    )
    return () => {
      current = false
    }
  }, [load, signature, tick])
  return { view, failed }
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' })

export function TodayCard({ view, failed }: { view: ActivityView | null; failed: boolean }) {
  if (view === null) {
    return (
      <div className="rounded-2xl bg-card p-3.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border/60">
        {failed ? 'Could not load activity.' : 'Loading…'}
      </div>
    )
  }
  const today = view.days[view.days.length - 1]
  if (view.since === null || today === undefined) {
    return <div className="rounded-2xl bg-card p-3.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border/60">Activity appears here as sessions run.</div>
  }
  const peak = Math.max(1, ...view.days.map(day => day.workedMs))
  const firstDay = view.days[0]?.date ?? ''
  return (
    <div className="grid gap-3 rounded-2xl bg-card p-3.5 shadow-sm ring-1 ring-border/60">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dd className="font-display text-lg font-semibold tabular-nums">{today.sessionsStarted}</dd>
          <dt className="text-[11px] text-muted-foreground">Sessions started</dt>
        </div>
        <div>
          <dd className="font-display text-lg font-semibold tabular-nums">{today.turnsCompleted}</dd>
          <dt className="text-[11px] text-muted-foreground">Turns done</dt>
        </div>
        <div>
          <dd className="font-display text-lg font-semibold tabular-nums">{formatWorked(today.workedMs)}</dd>
          <dt className="text-[11px] text-muted-foreground">Working time</dt>
        </div>
      </dl>
      <p className="text-center text-[11px] text-muted-foreground">Totals add up all sessions, so working time can be longer than the clock.</p>
      <div role="img" aria-label={activityDescription(view.days)} className="flex h-12 items-end gap-1.5">
        {view.days.map((day, index) => {
          const last = index === view.days.length - 1
          return (
            <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${day.date}: ${formatWorked(day.workedMs)}, ${day.turnsCompleted} turns`}>
              <div
                className={`w-full rounded-sm ${last ? 'bg-primary' : 'bg-primary/35'}`}
                style={{ height: `${Math.max(day.workedMs === 0 ? 0 : 8, Math.round((day.workedMs / peak) * 100))}%` }}
              />
              <span aria-hidden="true" className="text-[9px] leading-none text-muted-foreground">{WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}</span>
            </div>
          )
        })}
      </div>
      {view.since > new Date(`${firstDay}T00:00:00Z`).getTime() && (
        <p className="text-[11px] text-muted-foreground">Counting since {new Date(view.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}; earlier days are not recorded.</p>
      )}
    </div>
  )
}

const EVENT_ICON = { finished: CircleCheck, started: Plus, ended: Power } as const

export function ActivityFeed({ view, now, onOpen }: { view: ActivityView; now: number; onOpen(chatId: string): void }) {
  return (
    <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-border/60">
      {view.recent.map(event => {
        const Icon = EVENT_ICON[event.kind]
        return (
          <li key={event.id} className="min-w-0 border-b border-border/50 last:border-b-0">
            <button type="button" title={event.name} onClick={() => onOpen(event.chatId)} className="flex w-full min-w-0 items-center gap-2.5 px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50">
              <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{event.name}</span> {eventVerb(event.kind)}</span>
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">{formatDuration(now - event.at)} ago</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ProjectsGrid({ tiles, now, online, onOpenChat, onStartProject }: { tiles: ProjectTile[]; now: number; online: boolean; onOpenChat(chatId: string): void; onStartProject(cwd: string): Promise<void> }) {
  return (
    <ul className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2.5 md:grid-cols-[repeat(3,minmax(0,1fr))]">
      {tiles.map(tile => (
        <li key={tile.cwd} data-project={tile.cwd} className="relative grid min-w-0 gap-1 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-border/60">
          <button
            type="button"
            onClick={() => onOpenChat(tile.latestChatId)}
            className="grid min-w-0 gap-1 text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <span className="truncate text-sm font-medium">{tile.label}</span>
            <span className={`truncate text-[11px] ${tile.needsYou > 0 ? `font-medium ${NEEDS_YOU_TEXT_CLASS}` : 'text-muted-foreground'}`}>
              {tile.live === 0 ? 'No live sessions' : [`${tile.live} live`, tile.needsYou > 0 ? `${tile.needsYou} need you` : null].filter(Boolean).join(' · ')}
            </span>
            {tile.latestAt > 0 && <span className="text-[11px] text-muted-foreground">Active {formatDuration(now - tile.latestAt)} ago</span>}
          </button>
          <button
            type="button"
            aria-label={`New session in ${tile.label}`}
            title={`New session in ${tile.label}`}
            disabled={!online}
            onClick={() => void onStartProject(tile.cwd)}
            className="absolute right-2 top-2 z-10 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-45"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
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
      className="min-w-0 max-w-full shrink"
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
      <span className="min-w-0 truncate">{armed ? `Tap again to resume ${sessionName(chat)}` : `Resume ${sessionName(chat)}`}</span>
    </Button>
  )
}

export function Dashboard({ loadActivity, chats, usage, away, online, onOpenChat, onPromptAction, onToggleAway, onNewSession, onStartProject, onResume }: DashboardProps) {
  const now = useNow()
  const counts = dashboardCounts(chats)
  const needsYou = needsYouItems(chats)
  const working = workingItems(chats)
  const projects = recentProjects(chats)
  const tiles = projectTiles(chats)
  const lastAt = lastActivityAt(chats)
  const ended = lastEnded(chats)
  const { view: activity, failed: activityFailed } = useActivity(loadActivity, `${counts.needsYou}/${counts.working}/${counts.live}`)
  return (
    <div data-dashboard className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
      <div className="mx-auto grid w-full min-w-0 max-w-3xl grid-cols-[minmax(0,1fr)] gap-5">
        <div className="flex items-center justify-between gap-3 rounded-2xl px-1">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight">{away ? 'Away mode on' : 'Mission control'}</h2>
            <p aria-live="polite" className={`mt-0.5 text-sm ${counts.needsYou > 0 ? `font-medium ${NEEDS_YOU_TEXT_CLASS}` : 'text-muted-foreground'}`}>
              {summaryText(counts)}
            </p>
            {lastAt !== null && <p className="mt-0.5 text-xs text-muted-foreground">Last activity {formatDuration(now - lastAt)} ago</p>}
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

        {tiles.length > 0 && (
          <Section id="dash-projects" title="Projects">
            <ProjectsGrid tiles={tiles} now={now} online={online} onOpenChat={chatId => onOpenChat(chatId)} onStartProject={onStartProject} />
          </Section>
        )}

        {loadActivity !== undefined && (
          <Section id="dash-today" title="Today">
            <TodayCard view={activity} failed={activityFailed} />
          </Section>
        )}

        <Section id="dash-actions" title="Quick actions">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onNewSession}>
              <Plus aria-hidden="true" /> New session
            </Button>
            {projects.map(project => (
              <Button key={project.cwd} variant="outline" size="sm" className="min-w-0 max-w-full shrink" disabled={!online} title={project.cwd} onClick={() => void onStartProject(project.cwd)}>
                <Plus aria-hidden="true" /> <span className="min-w-0 truncate">{project.label}</span>
              </Button>
            ))}
            {ended !== null && <ResumeLast chat={ended} onResume={() => onResume(ended.id)} />}
          </div>
        </Section>

        {activity !== null && activity.recent.length > 0 && (
          <Section id="dash-recent" title="Recent activity">
            <ActivityFeed view={activity} now={now} onOpen={chatId => onOpenChat(chatId)} />
          </Section>
        )}
      </div>
    </div>
  )
}
