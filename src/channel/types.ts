// The Bridge's view of a messaging service. No Telegram types may appear here.

export type ThreadRef = string
export type MessageRef = string

export type AnswerButton = { kind: 'answer'; promptId: string; questionIndex: number; optionIndex: number }
/** A tap on a project in the /new picker. `choice` indexes the picker's project list. */
export type LaunchButton = { kind: 'launch'; pickerId: string; choice: number }
export type ButtonData = AnswerButton | LaunchButton
/** `detail` (a second line) and `at` (when the item was made) are for surfaces that show more than a label; Telegram uses the label. */
export type Button = { label: string; data: ButtonData; detail?: string; at?: number }
export type PromptViewItem = { text: string; buttons: { label: string; data: AnswerButton }[] }
export type PromptView = { promptId: string; title: string; items: PromptViewItem[] }

export type InboundText = { thread: ThreadRef | null; replyTo: MessageRef | null; text: string }
/** `args` is the text after the command, trimmed. */
export type InboundCommand = { name: string; args: string; thread: ThreadRef | null }

export interface ChannelHandlers {
  /** Returns the short toast shown to the user. */
  onButton(press: ButtonData): Promise<string>
  /** Returns a reply to post, or null for none. */
  onText(message: InboundText): Promise<string | null>
  /** Returns a reply to post, or null for none. */
  onCommand(command: InboundCommand): Promise<string | null>
}

/**
 * How a Spawned Session's startup is going. A channel that understands it shows one status that updates in place;
 * the others get `fallback`, the plain text Telegram has always shown.
 */
export type SessionStatus = {
  state: 'starting' | 'resuming' | 'ready' | 'failed'
  cwd: string
  tmuxName: string | null
  /** Failed only: what went wrong, in one line. */
  message: string | null
  /** Failed only: the screen output or reason behind it. */
  detail: string | null
  /** The legacy message, used when the channel has no `sessionStatus`. */
  fallback: string
}

export interface Channel {
  start(handlers: ChannelHandlers): Promise<void>
  stop(): Promise<void>
  createThread(title: string): Promise<ThreadRef>
  closeThread(thread: ThreadRef): Promise<void>
  renameThread(thread: ThreadRef, title: string): Promise<void>
  sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef>
  /** Optional: shows a Spawned Session's startup as one status that moves from starting to ready or failed. */
  sessionStatus?(thread: ThreadRef, status: SessionStatus): Promise<void>
  /** Sends one message with one button per row. */
  sendButtons(thread: ThreadRef | null, text: string, buttons: Button[]): Promise<MessageRef>
  /** Sends one message per view item, in order. */
  sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]>
  /** Removes buttons from the Prompt messages and posts the note. */
  markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void>
}
