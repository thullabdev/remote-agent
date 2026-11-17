import type { Chat, ForkView, PinView } from '../../../channel/web/protocol.ts'
import type { ApiClient } from '../../api.ts'
import type { OpenPanel } from '../../extension-slots.ts'

/** What the details panel reads from the API for a sub-agent: its activity, one page at a time. */
export type SubagentApi = Pick<ApiClient, 'subagentActivity'>

export type ChatInfoProps = {
  chat: Chat
  onClose(): void
  /** Reads a background sub-agent's activity. */
  api: SubagentApi
  /** The sub-agent whose activity replaces the session details, or null for the details. */
  subagent: { chatId: string; agentId: string; title: string } | null
  onCloseSubagent(): void
  /** Switches the panel to another sub-agent, from a sub-agent step inside this one. */
  onOpenSubagent?(agentId: string, title: string): void
  /** Shows a short message, for results that have no request behind them (a copy). */
  onNotify(message: string): void
  onEnd(): Promise<void>
  onArchive(): Promise<void>
  onUnarchive(): Promise<void>
  onRename(title: string): Promise<void>
  /** Pins the session to the top of the list, or unpins it. */
  onPin(pinned: boolean): Promise<void>
  /** Hides the chat history on every device. */
  onClear(): Promise<void>
  onFork(): Promise<void>
  onResume(): Promise<void>
  /** The bookmarked messages of this chat. */
  pins: PinView[]
  onUnpin(messageId: string): Promise<void>
  /** Closes the details and shows the bookmarked message in the chat, loading older history if needed. */
  onJump(pin: PinView): void
  /** The forks made from this chat, oldest first. Empty when not given. */
  forks?: ForkView[]
  /** Reads the forks again, for a fork made elsewhere (another device, or from another chat). */
  onRefreshForks?(): void | Promise<void>
  /** Closes the details and shows the reply a fork was made from, loading older history if needed. */
  onShowFork?(fork: ForkView): void
  /** Opens a fork's chat. */
  onOpenFork?(chatId: string): void
  /** The full model id the Session last ran on, or null when unknown. */
  model?: string | null
  /** Opens an extension panel, for the chat-info sections that link to one. */
  openPanel: OpenPanel
  /** The UI density preference, passed to the chat-info sections. */
  density: 'compact' | 'comfortable'
}

/** The two actions that still ask first: ending a process and hiding history. The rest are reversible and run at once. */
export type ConfirmAction = 'end' | 'clear'
