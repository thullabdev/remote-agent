import type { Chat } from '../../../src/channel/web/protocol.ts'
import type { Notify, OpenPanel } from '../../../src/ui/extension-slots.ts'
import { openSessionInFolder } from './grouping.ts'
import { createSession, listSessions, type SessionView } from './sessions-client.ts'
import { addSession, setSessions, terminalOf } from './store.ts'

/** The panel id this extension registers. Only this extension opens it. */
export const TERMINAL_PANEL = 'terminal'

/** Starts a shell in `cwd` (home when omitted), linked to a chat when given, and shows it. */
export async function startTerminal(input: { cwd?: string; chatId?: string | null }, openPanel: OpenPanel, notify: Notify): Promise<void> {
  try {
    const created = await createSession({ cwd: input.cwd, chatId: input.chatId ?? null })
    addSession(terminalOf({ sid: created.sid, cwd: created.cwd, chatId: input.chatId ?? null, createdAt: created.createdAt }))
    openPanel(TERMINAL_PANEL, { sid: created.sid })
  } catch (error) {
    notify(error instanceof Error ? error.message : 'Could not start the terminal', 'error')
  }
}

/**
 * A chat's terminal: the open shell for its project folder if there is one, else a new shell there, linked to the chat.
 * The server is asked first: a shell that exited is only known to it, so a cached list can name a session that is gone.
 */
export async function openTerminalForChat(chat: Chat, openPanel: OpenPanel, notify: Notify): Promise<void> {
  const folder = chat.launchCwd ?? chat.cwd ?? undefined
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
    openPanel(TERMINAL_PANEL, { sid: existing.sid })
    return
  }
  await startTerminal({ cwd: folder, chatId: chat.id }, openPanel, notify)
}
