import type { Instruction, Report } from '../../mod/remote-agent/hooks/protocol.ts'
import type { PromptRow, SessionRow } from '../bridge/store.ts'
import type { Message, UploadRef } from './web/protocol.ts'

/**
 * Structured chat output for the web channel. The Notifier calls it in addition to the Channel;
 * with no sink the Notifier behaves exactly as it did for Telegram alone.
 */
export interface ChatSink {
  /** Chat id this Session already owns (so a resumed Session keeps one chat), or null. */
  existingChat(session: SessionRow): string | null
  /** Called when the Bridge hears about a Session (any mod request, or after Spawner created its thread). Creates/links the chat eagerly; idempotent. */
  sessionSeen(session: SessionRow): void
  /** Appends the structured prompt message(s); returns their message ids in order (one per question for a Question, one for a Permission Request). */
  promptCreated(prompt: PromptRow, session: SessionRow): string[]
  /** Flips the prompt messages (the refs Notifier stored) to answered with the resolution. */
  promptResolved(prompt: PromptRow, refs: string[]): void
  /** Appends a user_text message (queued) for an Instruction; used by the web API, not by Inbound. A clientId makes the append idempotent. `display` is what the message shows when the Instruction text also carries file paths for the Session. */
  instructionQueued(instruction: Instruction, session: SessionRow, clientId?: string | null, display?: { text: string; attachments: UploadRef[] }): Message
  /** Flips the user_text of that instruction to delivered. */
  instructionDelivered(instructionId: string): void
  /** Session_started/ended -> system message; turn_complete -> agent_text unless the transcript probe says active (see below). */
  report(session: SessionRow, report: Report): void
  chatEnded(session: SessionRow): void
  busyChanged(sessionId: string, busy: boolean): void
  systemMessage(sessionId: string | null, text: string): void
  /** A Prompt still waiting after the reminder delay: a system message in the Session's chat, and a push. */
  promptReminder(prompt: PromptRow, session: SessionRow): void
}
