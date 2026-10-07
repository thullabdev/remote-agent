// The Bridge's view of a messaging service. No Telegram types may appear here.

export type ThreadRef = string
export type MessageRef = string

export type AnswerButton = { kind: 'answer'; promptId: string; questionIndex: number; optionIndex: number }
/** A tap on a project in the /new picker. `choice` indexes the picker's project list. */
export type LaunchButton = { kind: 'launch'; pickerId: string; choice: number }
export type ButtonData = AnswerButton | LaunchButton
export type Button = { label: string; data: ButtonData }
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

export interface Channel {
  start(handlers: ChannelHandlers): Promise<void>
  stop(): Promise<void>
  createThread(title: string): Promise<ThreadRef>
  closeThread(thread: ThreadRef): Promise<void>
  renameThread(thread: ThreadRef, title: string): Promise<void>
  sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef>
  /** Sends one message with one button per row. */
  sendButtons(thread: ThreadRef | null, text: string, buttons: Button[]): Promise<MessageRef>
  /** Sends one message per view item, in order. */
  sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]>
  /** Removes buttons from the Prompt messages and posts the note. */
  markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void>
}
