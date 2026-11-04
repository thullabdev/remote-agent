import type { Log } from '../bridge/prompts.ts'
import type { Button, Channel, ChannelHandlers, MessageRef, PromptView, ThreadRef } from '../channel/types.ts'
import type { ChatLog } from './chat-log.ts'
import type { PromptBodyView } from './protocol.ts'

const GENERAL_ID = 'general'

/** The web channel: a Channel whose threads are ChatLog chats. A null thread is General. */
export class WebChannel implements Channel {
  private current: ChannelHandlers | null = null

  constructor(
    private readonly chatLog: ChatLog,
    private readonly log: Log,
  ) {}

  get handlers(): ChannelHandlers | null {
    return this.current
  }

  async start(handlers: ChannelHandlers): Promise<void> {
    this.current = handlers
  }

  async stop(): Promise<void> {
    this.current = null
    this.log('web channel stopped')
  }

  async createThread(title: string): Promise<ThreadRef> {
    const id = `c_${crypto.randomUUID()}`
    this.chatLog.createChat({ id, sessionId: null, title })
    return id
  }

  async closeThread(thread: ThreadRef): Promise<void> {
    this.chatLog.updateChat(thread, { status: 'ended' })
  }

  async renameThread(thread: ThreadRef, title: string): Promise<void> {
    this.chatLog.updateChat(thread, { title })
  }

  async sendText(thread: ThreadRef | null, text: string, _replyTo: MessageRef | null): Promise<MessageRef> {
    const message =
      thread === null
        ? this.chatLog.appendMessage(GENERAL_ID, { kind: 'command_reply', text })
        : this.chatLog.appendMessage(thread, { kind: 'system', text })
    return message.id
  }

  async sendButtons(thread: ThreadRef | null, text: string, buttons: Button[]): Promise<MessageRef> {
    const picks = buttons.map(button => {
      if (button.data.kind !== 'launch') {
        throw new Error(`Web picker buttons must be launch buttons, got ${button.data.kind}`)
      }
      return { label: button.label, choice: button.data.choice, pickerId: button.data.pickerId }
    })
    const pickerId = picks[0]?.pickerId
    if (pickerId === undefined) {
      throw new Error('A web picker needs at least one button')
    }
    if (picks.some(pick => pick.pickerId !== pickerId)) {
      throw new Error('All buttons of a web picker must share one pickerId')
    }
    const message = this.chatLog.appendMessage(thread ?? GENERAL_ID, {
      kind: 'picker',
      pickerId,
      text,
      buttons: picks.map(({ label, choice }) => ({ label, choice })),
    })
    return message.id
  }

  async sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]> {
    return view.items.map(item => {
      const body: PromptBodyView = {
        kind: 'question',
        questions: [
          {
            question: item.text,
            header: '',
            multiSelect: false,
            options: item.buttons.map(button => ({ label: button.label, description: '' })),
            answered: null,
          },
        ],
      }
      const message = this.chatLog.appendMessage(thread, {
        kind: 'prompt',
        promptId: view.promptId,
        title: view.title,
        body,
        status: 'pending',
        resolution: null,
      })
      return message.id
    })
  }

  async markResolved(_thread: ThreadRef, messages: MessageRef[], note: string): Promise<void> {
    for (const ref of messages) {
      const current = this.chatLog.findMessage(ref)
      if (current?.kind !== 'prompt') {
        throw new Error(`Message ${ref} is not a prompt`)
      }
      this.chatLog.updateMessage(ref, {
        kind: 'prompt',
        promptId: current.promptId,
        title: current.title,
        body: current.body,
        status: 'answered',
        resolution: { note, source: 'remote' },
      })
    }
  }
}
