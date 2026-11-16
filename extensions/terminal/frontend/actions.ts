import type { Chat } from '../../../src/channel/web/protocol.ts'
import type { Notify, OpenSideTab } from '../../../src/ui/extension-slots.ts'
import { openSessionInFolder } from './grouping.ts'
import { createSession, listSessions, type SessionView } from './sessions-client.ts'
import { addSession, selectTerminal, setSessions, terminalOf } from './store.ts'

/** The side tab this extension registers. Its shells and emulator live there. */
export const TERMINAL_TAB = 'terminal'

/** The folder a new shell starts in for a chat: its launch folder. Undefined when the chat has no folder, so the caller asks instead. */
export function chatFolder(chat: Chat | null): string | undefined {
  return chat === null ? undefined : (chat.launchCwd ?? chat.cwd ?? undefined)
}

/** Starts a shell in `cwd` (home when omitted), linked to a chat when given, and shows it in the side tab. Returns its id, or null when it failed. */
export async function startTerminal(input: { cwd?: string; chatId?: string | null }, notify: Notify): Promise<string | null> {
  try {
    const created = await createSession({ cwd: input.cwd, chatId: input.chatId ?? null })
    addSession(terminalOf({ sid: created.sid, cwd: created.cwd, chatId: input.chatId ?? null, createdAt: created.createdAt }))
    selectTerminal(created.sid)
    return created.sid
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not start the terminal', 'error')
    return null
  }
}

/**
 * A chat's terminal: shows the side tab, then the open shell for the chat's folder if there is one, else a new shell there,
 * linked to the chat. The server is asked first: a shell that exited is only known to it, so a cached list can name a session that is gone.
 */
export async function openTerminalForChat(chat: Chat, openSideTab: OpenSideTab, notify: Notify): Promise<void> {
  openSideTab(TERMINAL_TAB)
  const folder = chatFolder(chat)
  let sessions: SessionView[]
  try {
    sessions = await listSessions()
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not reach the terminals', 'error')
    return
  }
  setSessions(sessions.map(terminalOf))
  const existing = folder === undefined ? undefined : openSessionInFolder(sessions, folder)
  if (existing !== undefined) {
    selectTerminal(existing.sid)
    return
  }
  await startTerminal({ cwd: folder, chatId: chat.id }, notify)
}
