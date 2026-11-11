import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityView, Chat, UsageView } from '../../src/channel/web/protocol.ts'
import { ChatHeader } from '../../src/ui/components/chat-header.tsx'
import { ActivityFeed, Dashboard, TodayCard, type DashboardProps } from '../../src/ui/components/dashboard.tsx'

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id, title: `Title ${id}`, project: null, cwd: null, status: 'active', spawned: false, archived: false, busy: false, unread: 0,
    lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null, ...patch,
  }
}

const usage: UsageView = { accounts: [], chats: {} }
const noop = async () => {}

function render(chats: Chat[], patch: Partial<DashboardProps> = {}): string {
  return renderToStaticMarkup(
    createElement(Dashboard, {
      chats, usage, away: false, online: true, onOpenChat: () => {}, onPromptAction: noop, onToggleAway: () => {}, onNewSession: () => {},
      onStartProject: noop, onResume: noop, ...patch,
    }),
  )
}

const permission = { promptId: 'p1', kind: 'permission' as const, summary: 'Bash: rm -rf build', at: Date.now() - 4 * 60_000, count: 1 }

test('a permission request shows its full command with Allow and Deny', () => {
  const html = render([chat('a', { project: 'api', busy: true, pendingPrompt: permission })])
  expect(html).toContain('data-needs-you="a"')
  expect(html).toContain('Bash: rm -rf build')
  expect(html).toContain('>Allow<')
  expect(html).toContain('>Deny<')
  expect(html).toContain('waiting 4m')
  expect(html).toContain('1 needs you')
})

test('a question opens the chat instead of offering quick answers', () => {
  const html = render([chat('a', { busy: true, pendingPrompt: { ...permission, kind: 'question', summary: 'Which database?' } })])
  expect(html).toContain('Which database?')
  expect(html).toContain('>Answer<')
  expect(html).not.toContain('>Allow<')
})

test('answers are disabled while offline', () => {
  const html = render([chat('a', { busy: true, pendingPrompt: permission })], { online: false })
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Deny</)
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Allow</)
})

test('working sessions show their latest step, and sections hide when empty', () => {
  const working = render([chat('b', { project: 'web', busy: true, lastMessage: { seq: 1, at: Date.now(), preview: 'Running tests' } })])
  expect(working).toContain('data-working="b"')
  expect(working).toContain('Running tests')
  expect(working).not.toContain('Needs you')

  const quiet = render([chat('c')])
  expect(quiet).not.toContain('Working now')
  expect(quiet).not.toContain('data-needs-you')
  expect(quiet).toContain('All quiet · 1 live session')
  expect(quiet).toContain('New session')
})

test('quick actions offer recent projects and the last ended session', () => {
  const html = render([
    chat('a', { cwd: '/w/api', project: 'api', lastMessage: { seq: 1, at: 5, preview: 'x' } }),
    chat('z', { status: 'ended', project: 'web', cwd: '/w/web', lastMessage: { seq: 1, at: 4, preview: 'y' } }),
  ])
  expect(html).toContain('title="/w/api"')
  expect(html).toContain('Resume web')
})

test('away mode is announced and the toggle reflects it', () => {
  const html = render([], { away: true })
  expect(html).toContain('Away mode on')
  expect(html).toContain('aria-pressed="true"')
})

test('budget says so when there is no usage yet', () => {
  expect(render([])).toContain('No limit data yet')
})

test('General offers the Dashboard and Chat switch with the summary under its name', () => {
  const html = renderToStaticMarkup(
    createElement(ChatHeader, {
      chat: chat('general', { title: 'General' }), status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {},
      view: 'dashboard', onView: () => {}, summary: '2 need you · 3 working',
    }),
  )
  expect(html).toContain('aria-label="General view"')
  expect(html).toMatch(/aria-pressed="true"[^>]*>dashboard</)
  expect(html).toContain('2 need you · 3 working')

  const session = renderToStaticMarkup(
    createElement(ChatHeader, { chat: chat('s'), status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {} }),
  )
  expect(session).not.toContain('General view')
})

const day = (date: string, turns: number, worked: number, started = 0) => ({ date, sessionsStarted: started, turnsCompleted: turns, workedMs: worked })
const activityView: ActivityView = {
  days: [day('2026-11-04', 0, 0), day('2026-11-05', 2, 1_800_000), day('2026-11-06', 0, 0), day('2026-11-07', 1, 600_000), day('2026-11-08', 0, 0), day('2026-11-09', 4, 3_600_000), day('2026-11-10', 3, 4_500_000, 2)],
  recent: [
    { id: 3, at: Date.now() - 4 * 60_000, chatId: 'a', kind: 'finished', name: 'api' },
    { id: 2, at: Date.now() - 60 * 60_000, chatId: 'b', kind: 'started', name: 'web' },
  ],
  since: Date.UTC(2026, 10, 4),
}

test('the Today card shows today\'s numbers and a chart for the week', () => {
  const html = renderToStaticMarkup(createElement(TodayCard, { view: activityView, failed: false }))
  expect(html).toContain('>2<')
  expect(html).toContain('>3<')
  expect(html).toContain('1h 15m')
  expect(html).toContain('>Working time<')
  expect(html).toContain('add up all sessions')
  expect(html).toContain('role="img"')
  expect(html).toContain('10 turns completed in the last 7 days')
  expect(html).not.toContain('Counting since')
})

test('the Today card says when recording began partway through the window, and when there is nothing yet', () => {
  const late = renderToStaticMarkup(createElement(TodayCard, { view: { ...activityView, since: Date.UTC(2026, 10, 9) }, failed: false }))
  expect(late).toContain('Counting since')
  expect(renderToStaticMarkup(createElement(TodayCard, { view: { days: [], recent: [], since: null }, failed: false }))).toContain('Activity appears here')
  expect(renderToStaticMarkup(createElement(TodayCard, { view: null, failed: true }))).toContain('Could not load activity.')
  expect(renderToStaticMarkup(createElement(TodayCard, { view: null, failed: false }))).toContain('Loading')
})

test('the activity feed lists events with their session and age', () => {
  const html = renderToStaticMarkup(createElement(ActivityFeed, { view: activityView, now: Date.now(), onOpen: () => {} }))
  expect(html).toContain('api</span> finished')
  expect(html).toContain('web</span> started')
  expect(html).toContain('4m ago')
})

test('Today appears only when the dashboard can load activity', () => {
  expect(render([])).not.toContain('Today')
  expect(render([], { loadActivity: async () => activityView })).toContain('Today')
})

test('cards lead with the session title and show the project small above it', () => {
  const html = render([chat('a', { project: 'api', title: 'api · Fix billing', busy: true, pendingPrompt: permission })])
  expect(html).toContain('>api · Fix billing<')
  expect(html).toContain('>api<')
  const working = render([chat('b', { project: 'web', title: 'web · Docs', busy: true, lastMessage: { seq: 1, at: Date.now(), preview: 'Running tests' } })])
  expect(working).toContain('>web · Docs<')
  expect(working).toContain('>web<')
})

test('the project line is left out when it is the same as the title', () => {
  const html = render([chat('a', { project: 'api', title: 'api', busy: true, pendingPrompt: permission })])
  expect(html.match(/>api</g)?.length).toBe(1)
})

test('the projects grid shows each folder once with its counts and a new-session button', () => {
  const html = render([
    chat('a', { cwd: '/w/api', project: 'api', busy: true, pendingPrompt: permission, lastMessage: { seq: 1, at: Date.now() - 60_000, preview: 'x' } }),
    chat('b', { cwd: '/w/api', project: 'api', lastMessage: { seq: 2, at: Date.now() - 5 * 60_000, preview: 'y' } }),
    chat('c', { cwd: '/w/web', project: 'web' }),
  ])
  expect(html).toContain('data-project="/w/api"')
  expect(html).toContain('2 live · 1 need you')
  expect(html).toContain('Active 1m ago')
  expect(html).toContain('aria-label="New session in api"')
  expect(html).toContain('1 live</span>')
  expect(html).toContain('Last activity 1m ago')
})

test('the General avatar glows only while a session needs you', () => {
  const general = chat('general', { title: 'General' })
  const glow = (needsYou: number) => renderToStaticMarkup(createElement(ChatHeader, { chat: general, status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {}, needsYou }))
  expect(glow(2)).toContain('animate-pulse')
  expect(glow(0)).not.toContain('animate-pulse')
})

test('the layout keeps a fixed column so long text cannot widen the cards', () => {
  const html = render([chat('b', { project: 'web', busy: true, lastMessage: { seq: 1, at: Date.now(), preview: 'x'.repeat(300) } })])
  expect(html).toContain('grid-cols-[minmax(0,1fr)]')
  expect(html).toContain('data-working="b"')
})

test('General has no usage toggle and no details button; a session keeps both', () => {
  const header = (chatValue: Chat) => renderToStaticMarkup(
    createElement(ChatHeader, { chat: chatValue, status: 'connected', onBack: () => {}, onInfo: () => {}, infoOpen: false, onRename: async () => {} }),
  )
  const general = header(chat('general', { title: 'General' }))
  expect(general).not.toContain('chat-usage-panel')
  expect(general).not.toContain('Session information and actions')
  const session = header(chat('s1'))
  expect(session).toContain('Session information and actions')
})
