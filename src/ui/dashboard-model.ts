import { chatState } from '../channel/web/chat-state.ts'
import type { Chat, PendingPrompt } from '../channel/web/protocol.ts'
import type { UsageView } from '../channel/web/protocol.ts'

// What the General dashboard shows, derived from the chat list and usage. Pure, so it is tested without React.

const GENERAL_ID = 'general'

/** The sessions a person can act on: not General, not archived. */
function sessionsOf(chats: Chat[]): Chat[] {
  return chats.filter(chat => chat.id !== GENERAL_ID && !chat.archived)
}

/** What a session is called on the dashboard: its project when it has one, else its title. */
export function sessionName(chat: Pick<Chat, 'project' | 'title'>): string {
  return chat.project ?? chat.title
}

export type NeedsYouItem = {
  chatId: string
  name: string
  title: string
  prompt: PendingPrompt
}

/** Sessions waiting on an answer, the one waiting longest first. */
export function needsYouItems(chats: Chat[]): NeedsYouItem[] {
  const items: NeedsYouItem[] = []
  for (const chat of sessionsOf(chats)) {
    if (chatState(chat) === 'needs_you' && chat.pendingPrompt !== null) {
      items.push({ chatId: chat.id, name: sessionName(chat), title: chat.title, prompt: chat.pendingPrompt })
    }
  }
  return items.sort((a, b) => a.prompt.at - b.prompt.at)
}

export type WorkingItem = {
  chatId: string
  name: string
  title: string
  /** The newest thing the session did, as one line. Null before it has said anything. */
  step: string | null
  /** When that happened (ms epoch), or null. */
  at: number | null
}

/** Sessions mid-turn, the most recently active first. A session that needs you is not listed: it has its own card. */
export function workingItems(chats: Chat[]): WorkingItem[] {
  const items: WorkingItem[] = []
  for (const chat of sessionsOf(chats)) {
    if (chatState(chat) === 'working') {
      items.push({
        chatId: chat.id,
        name: sessionName(chat),
        title: chat.title,
        step: chat.lastMessage?.preview ?? null,
        at: chat.lastMessage?.at ?? null,
      })
    }
  }
  return items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

export type DashboardCounts = { needsYou: number; working: number; live: number }

export function dashboardCounts(chats: Chat[]): DashboardCounts {
  const sessions = sessionsOf(chats)
  return {
    needsYou: sessions.filter(chat => chatState(chat) === 'needs_you').length,
    working: sessions.filter(chat => chatState(chat) === 'working').length,
    live: sessions.filter(chat => chat.status !== 'ended').length,
  }
}

/** One line for the greeting and for General's header: what needs attention first. */
export function summaryText(counts: DashboardCounts): string {
  const parts: string[] = []
  if (counts.needsYou > 0) {
    parts.push(`${counts.needsYou} ${counts.needsYou === 1 ? 'needs' : 'need'} you`)
  }
  if (counts.working > 0) {
    parts.push(`${counts.working} working`)
  }
  if (parts.length > 0) {
    return parts.join(' · ')
  }
  if (counts.live === 0) {
    return 'No live sessions'
  }
  return `All quiet · ${counts.live} live ${counts.live === 1 ? 'session' : 'sessions'}`
}

export type RecentProject = { cwd: string; label: string }

function folderName(cwd: string): string {
  const parts = cwd.split('/').filter(part => part !== '')
  return parts[parts.length - 1] ?? cwd
}

/** The folders most recently worked in, newest first, one entry per folder, for one-tap new sessions. */
export function recentProjects(chats: Chat[], limit = 3): RecentProject[] {
  const latest = new Map<string, { label: string; at: number }>()
  for (const chat of sessionsOf(chats)) {
    if (chat.cwd === null) {
      continue
    }
    const at = chat.lastMessage?.at ?? 0
    const known = latest.get(chat.cwd)
    if (known === undefined || at > known.at) {
      latest.set(chat.cwd, { label: chat.project ?? folderName(chat.cwd), at })
    }
  }
  return [...latest.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([cwd, value]) => ({ cwd, label: value.label }))
}

/** The ended session most recently active, for "Resume last ended". Null when there is none. */
export function lastEnded(chats: Chat[]): Chat | null {
  let best: Chat | null = null
  for (const chat of sessionsOf(chats)) {
    if (chat.status === 'ended' && (best === null || (chat.lastMessage?.at ?? 0) > (best.lastMessage?.at ?? 0))) {
      best = chat
    }
  }
  return best
}

export type BusiestContext = { chatId: string; name: string; percent: number }

/** The live session closest to filling its context window, or null when no live session reports one. */
export function busiestContext(chats: Chat[], usage: UsageView): BusiestContext | null {
  let best: BusiestContext | null = null
  for (const chat of sessionsOf(chats)) {
    const percent = chat.status === 'ended' ? null : usage.chats[chat.id]?.contextPercent ?? null
    if (percent !== null && (best === null || percent > best.percent)) {
      best = { chatId: chat.id, name: sessionName(chat), percent }
    }
  }
  return best
}
