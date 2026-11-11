import { describe, expect, test } from 'bun:test'
import type { Chat, UsageView } from '../../src/channel/web/protocol.ts'
import { activityBuckets, activityDescription, activityTime, busiestContext, eventVerb, formatWorked, lastActivityAt, projectTiles, dashboardCounts, lastEnded, needsYouItems, recentProjects, summaryText, workingItems } from '../../src/ui/dashboard-model.ts'

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id, title: `Title ${id}`, project: null, cwd: null, status: 'active', spawned: false, archived: false, busy: false, unread: 0,
    lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, activity: null, ...patch,
  }
}

const prompt = (at: number, kind: 'permission' | 'question' = 'permission') => ({ promptId: `p${at}`, kind, summary: 'Bash: bun test', at, count: 1 })
const message = (at: number, preview = 'hello') => ({ seq: 1, at, preview })
const usage = (chats: UsageView['chats'] = {}): UsageView => ({ accounts: [], chats })
const session = (percent: number | null) => ({ measuredAt: 0, contextPercent: percent, contextTokens: null, contextWindow: 200_000, costUsd: null })

describe('needsYouItems', () => {
  test('lists the session waiting longest first and skips General, archived and ended chats', () => {
    const chats = [
      chat('new', { busy: true, pendingPrompt: prompt(2_000) }),
      chat('old', { busy: true, pendingPrompt: prompt(1_000), project: 'api' }),
      chat('general', { pendingPrompt: prompt(500) }),
      chat('archived', { archived: true, pendingPrompt: prompt(600) }),
      chat('ended', { status: 'ended', pendingPrompt: prompt(700) }),
    ]
    expect(needsYouItems(chats).map(item => item.chatId)).toEqual(['old', 'new'])
    expect(needsYouItems(chats)[0]).toMatchObject({ project: 'api', title: 'Title old' })
  })
})

describe('workingItems', () => {
  test('lists working sessions newest activity first, leaving out ones that need you', () => {
    const chats = [
      chat('a', { busy: true, lastMessage: message(1_000, 'Editing a.ts') }),
      chat('b', { busy: true, lastMessage: message(3_000, 'Running tests') }),
      chat('c', { busy: true, pendingPrompt: prompt(1) }),
      chat('d', { busy: false }),
      chat('e', { busy: true, status: 'ended' }),
    ]
    const items = workingItems(chats)
    expect(items.map(item => item.chatId)).toEqual(['b', 'a'])
    expect(items[0]?.step).toBe('Running tests')
  })

  test('shows the running tool and its start when there is one', () => {
    const items = workingItems([chat('a', { busy: true, lastMessage: message(9_000, 'older'), activity: { tool: 'Bash', summary: 'bun test', at: 4_000 } })])
    expect(items[0]).toMatchObject({ step: 'Bash: bun test', at: 4_000 })
    const bare = workingItems([chat('a', { busy: true, activity: { tool: 'Read', summary: '', at: 1 } })])
    expect(bare[0]?.step).toBe('Read')
  })

  test('has no step before the session has said anything', () => {
    expect(workingItems([chat('a', { busy: true })])[0]?.step).toBeNull()
  })
})

describe('summary', () => {
  test('counts by state and reads attention first', () => {
    const chats = [chat('a', { busy: true, pendingPrompt: prompt(1) }), chat('b', { busy: true }), chat('c'), chat('d', { status: 'ended' })]
    const counts = dashboardCounts(chats)
    expect(counts).toEqual({ needsYou: 1, working: 1, live: 3 })
    expect(summaryText(counts)).toBe('1 needs you · 1 working')
    expect(summaryText({ needsYou: 2, working: 0, live: 2 })).toBe('2 need you')
  })

  test('says so when nothing is happening', () => {
    expect(summaryText({ needsYou: 0, working: 0, live: 0 })).toBe('No live sessions')
    expect(summaryText({ needsYou: 0, working: 0, live: 1 })).toBe('All quiet · 1 live session')
    expect(summaryText({ needsYou: 0, working: 0, live: 3 })).toBe('All quiet · 3 live sessions')
  })
})

describe('recentProjects', () => {
  test('keeps one entry per folder, newest first, capped', () => {
    const chats = [
      chat('a', { cwd: '/w/api', project: 'api', lastMessage: message(1_000) }),
      chat('b', { cwd: '/w/api', project: 'api', lastMessage: message(5_000) }),
      chat('c', { cwd: '/w/web', lastMessage: message(3_000) }),
      chat('d', { cwd: '/w/docs', lastMessage: message(2_000) }),
      chat('e', { cwd: '/w/old', lastMessage: message(100) }),
      chat('f', { cwd: null }),
      chat('g', { cwd: '/w/gone', archived: true, lastMessage: message(9_000) }),
    ]
    expect(recentProjects(chats)).toEqual([
      { cwd: '/w/api', label: 'api' },
      { cwd: '/w/web', label: 'web' },
      { cwd: '/w/docs', label: 'docs' },
    ])
  })
})

describe('lastEnded', () => {
  test('is the ended session most recently active, or null', () => {
    expect(lastEnded([chat('a')])).toBeNull()
    const chats = [chat('a', { status: 'ended', lastMessage: message(1) }), chat('b', { status: 'ended', lastMessage: message(2) }), chat('c', { status: 'ended', archived: true, lastMessage: message(3) })]
    expect(lastEnded(chats)?.id).toBe('b')
  })
})

describe('busiestContext', () => {
  test('is the live session with the fullest context', () => {
    const chats = [chat('a', { project: 'api' }), chat('b'), chat('c', { status: 'ended' })]
    const found = busiestContext(chats, usage({ a: session(40), b: session(82), c: session(99) }))
    expect(found).toEqual({ chatId: 'b', name: 'Title b', percent: 82 })
  })

  test('is null when nothing reports a context', () => {
    expect(busiestContext([chat('a')], usage({ a: session(null) }))).toBeNull()
  })
})

describe('activity wording', () => {
  test('worked time is short and never says now', () => {
    expect(formatWorked(0)).toBe('0m')
    expect(formatWorked(59_000)).toBe('0m')
    expect(formatWorked(45 * 60_000)).toBe('45m')
    expect(formatWorked(130 * 60_000)).toBe('2h 10m')
  })

  test('verbs and the chart description', () => {
    expect(eventVerb('finished')).toBe('finished')
    expect(eventVerb('started')).toBe('started')
    expect(eventVerb('ended')).toBe('ended')
    const days = [
      { date: '2026-11-09', sessionsStarted: 0, turnsCompleted: 1, workedMs: 1 },
      { date: '2026-11-10', sessionsStarted: 2, turnsCompleted: 3, workedMs: 2 },
    ]
    expect(activityDescription(days)).toBe('4 turns completed in the last 2 days. 2026-11-09: 1, 2026-11-10: 3.')
    expect(activityDescription([{ date: '2026-11-10', sessionsStarted: 0, turnsCompleted: 1, workedMs: 0 }])).toContain('1 turn completed in the last 1 days')
  })
})

describe('projectTiles', () => {
  test('one tile per folder, counting live and waiting sessions, needs-you first', () => {
    const chats = [
      chat('a1', { cwd: '/w/api', project: 'api', lastMessage: message(1_000) }),
      chat('a2', { cwd: '/w/api', project: 'api', busy: true, pendingPrompt: prompt(900), lastMessage: message(5_000) }),
      chat('a3', { cwd: '/w/api', project: 'api', status: 'ended', lastMessage: message(100) }),
      chat('w1', { cwd: '/w/web', project: 'web', lastMessage: message(9_000) }),
      chat('x', { cwd: '/w/old', status: 'ended', lastMessage: message(50) }),
      chat('g', { cwd: '/w/gen', archived: true }),
      chat('n', { cwd: null }),
    ]
    const tiles = projectTiles(chats)
    expect(tiles.map(tile => tile.label)).toEqual(['api', 'web', 'old'])
    expect(tiles[0]).toEqual({ cwd: '/w/api', label: 'api', live: 2, needsYou: 1, latestChatId: 'a2', latestAt: 5_000 })
    expect(tiles[1]).toMatchObject({ live: 1, needsYou: 0, latestChatId: 'w1' })
  })

  test('a folder with no activity yet still shows, last', () => {
    const tiles = projectTiles([chat('a', { cwd: '/w/new', project: 'new' }), chat('b', { cwd: '/w/busy', project: 'busy', lastMessage: message(3) })])
    expect(tiles.map(tile => [tile.label, tile.latestAt])).toEqual([['busy', 3], ['new', 0]])
  })

  test('is capped', () => {
    const chats = Array.from({ length: 9 }, (_, index) => chat(`c${index}`, { cwd: `/w/p${index}`, lastMessage: message(index) }))
    expect(projectTiles(chats)).toHaveLength(6)
  })
})

describe('lastActivityAt', () => {
  test('is the newest message across live and ended sessions, or null', () => {
    expect(lastActivityAt([chat('a')])).toBeNull()
    expect(lastActivityAt([chat('a', { lastMessage: message(4) }), chat('b', { status: 'ended', lastMessage: message(9) }), chat('general', { lastMessage: message(99) })])).toBe(9)
  })
})

describe('recent activity groups and times', () => {
  const now = new Date(2026, 10, 11, 15, 0).getTime()
  const line = (id: number, at: number) => ({ id, at, firstAt: at, chatId: 'a', kind: 'finished' as const, name: 'api', turns: 1, preview: null })

  test('lines fall under Last hour, Earlier today, Yesterday and Earlier, in order', () => {
    const lines = [line(1, now - 5 * 60_000), line(2, now - 2 * 3_600_000), line(3, new Date(2026, 10, 10, 20).getTime()), line(4, new Date(2026, 10, 2, 9).getTime())]
    expect(activityBuckets(lines, now).map(bucket => [bucket.label, bucket.events.map(event => event.id)])).toEqual([
      ['Last hour', [1]],
      ['Earlier today', [2]],
      ['Yesterday', [3]],
      ['Earlier', [4]],
    ])
  })

  test('an hour or less reads as an age, and older lines read as the clock time', () => {
    expect(activityTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(activityTime(new Date(2026, 10, 11, 9, 7).getTime(), now)).toBe('09:07')
  })
})
