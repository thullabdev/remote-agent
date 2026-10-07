import type { Channel, ChannelHandlers, MessageRef, PromptView, ThreadRef } from '../../src/channel/types.ts'

export class FakeChannel implements Channel {
  threads: { ref: ThreadRef; title: string; closed: boolean }[] = []
  texts: { thread: ThreadRef | null; text: string; replyTo: MessageRef | null }[] = []
  prompts: { thread: ThreadRef; view: PromptView; refs: MessageRef[] }[] = []
  resolved: { thread: ThreadRef; messages: MessageRef[]; note: string }[] = []
  handlers: ChannelHandlers | null = null
  createThreadDelayMs = 0
  private nextId = 1

  async start(handlers: ChannelHandlers): Promise<void> {
    this.handlers = handlers
  }

  async stop(): Promise<void> {}

  async createThread(title: string): Promise<ThreadRef> {
    if (this.createThreadDelayMs > 0) {
      await Bun.sleep(this.createThreadDelayMs)
    }
    const ref = `t${this.nextId++}`
    this.threads.push({ ref, title, closed: false })
    return ref
  }

  async closeThread(thread: ThreadRef): Promise<void> {
    const found = this.threads.find(item => item.ref === thread)
    if (found !== undefined) {
      found.closed = true
    }
  }

  renameFails = false

  async renameThread(thread: ThreadRef, title: string): Promise<void> {
    if (this.renameFails) {
      throw new Error('rename failed')
    }
    const found = this.threads.find(item => item.ref === thread)
    if (found !== undefined) {
      found.title = title
    }
  }

  async sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef> {
    this.texts.push({ thread, text, replyTo })
    return `m${this.nextId++}`
  }

  async sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]> {
    const refs = view.items.map(() => `m${this.nextId++}`)
    this.prompts.push({ thread, view, refs })
    return refs
  }

  async markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void> {
    this.resolved.push({ thread, messages, note })
  }
}

/** Lets fire-and-forget promise chains settle. */
export function flush(): Promise<void> {
  return Bun.sleep(10)
}
