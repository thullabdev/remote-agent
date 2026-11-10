import { describe, expect, test } from 'bun:test'
import type { Chat, UsageView } from '../../src/channel/web/protocol.ts'
import { busiestContext, dashboardCounts, lastEnded, needsYouItems, recentProjects, summaryText, workingItems } from '../../src/ui/dashboard-model.ts'

function chat(id: string, patch: Partial<Chat> = {}): Chat {
  return {
    id, title: `Title ${id}`, project: null, cwd: null, status: 'active', spawned: false, archived: false, busy: false, unread: 0,
    lastMessage: null, draft: null, pinned: false, tmuxName: null, pendingPrompt: null, ...patch,
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
    expect(needsYouItems(chats)[0]?.name).toBe('api')
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
