import type { Instruction, Report } from '../../mod/remote-agent/hooks/protocol.ts'
import type { Log } from '../bridge/prompts.ts'
import type { PromptRow, SessionRow, Store } from '../bridge/store.ts'
import { permissionSummaryFull, plainResolutionNote, sessionLabel, threadTitle } from '../bridge/views.ts'
import type { Button, Channel, ChannelHandlers, MessageRef, PromptView, ThreadRef } from '../channel/types.ts'
import type { ChatSink } from '../channel/chat-sink.ts'
import type { ChatLog } from './chat-log.ts'
import { clientSourceId, type Message, type PromptBodyView } from './protocol.ts'

const GENERAL_ID = 'general'

/** The web channel: a Channel whose threads are ChatLog chats, and the ChatSink that fills them. A null thread is General. */
export class WebChannel implements Channel, ChatSink {
  private current: ChannelHandlers | null = null
  private transcriptActive: (sessionId: string) => boolean = () => false
  private transcriptAttach: (sessionId: string) => void = () => {}
  private transcriptDetach: (sessionId: string) => void = () => {}

  constructor(
    private readonly chatLog: ChatLog,
    private readonly log: Log,
    private readonly store: Store,
  ) {}

  /** Tells whether the transcript reader is active for a Session; its turn text then comes from the reader, not from the Report. */
  setTranscriptProbe(probe: (sessionId: string) => boolean): void {
    this.transcriptActive = probe
  }

  /** Starts the transcript reader when a Session's chat is linked, and stops it when the chat ends. */
  setTranscriptAttacher(attach: (sessionId: string) => void, detach: (sessionId: string) => void = () => {}): void {
    this.transcriptAttach = attach
    this.transcriptDetach = detach
  }

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

  existingChat(session: SessionRow): string | null {
    const chatId = this.chatIdOf(session.id)
    if (chatId === null) {
      return null
    }
    const chat = this.chatLog.getChat(chatId)
    if (chat === undefined) {
      return null
    }
    // A resumed Session is active again; a Spawned Session that ended stays ended.
    if (chat.status === 'ended' && session.endedAt === null) {
      this.chatLog.updateChat(chatId, { status: 'active' })
    }
    return chatId
  }

  sessionSeen(session: SessionRow): void {
    this.chatFor(session)
    this.transcriptAttach(session.id)
  }

  promptCreated(prompt: PromptRow, session: SessionRow): string[] {
    const chatId = this.chatFor(session)
    const title = sessionLabel(session)
    const body = prompt.body
    if (body.kind === 'question') {
      return body.questions.map(question => {
        const view: PromptBodyView = {
          kind: 'question',
          questions: [
            {
              question: question.question,
              header: question.header,
              multiSelect: question.multiSelect,
              options: question.options.map(option => ({ label: option.label, description: option.description })),
              answered: null,
            },
          ],
        }
        return this.chatLog.appendMessage(chatId, { kind: 'prompt', promptId: prompt.id, title, body: view, status: 'pending', resolution: null }).id
      })
    }
    const view: PromptBodyView = {
      kind: 'permission',
      tool: body.tool,
      summary: permissionSummaryFull(body.tool, body.input),
      reason: body.reason ?? null,
      agentId: body.agentId ?? null,
    }
    return [this.chatLog.appendMessage(chatId, { kind: 'prompt', promptId: prompt.id, title, body: view, status: 'pending', resolution: null }).id]
  }

  promptResolved(prompt: PromptRow, refs: string[]): void {
    const answer = prompt.answer
    const source = prompt.source
    if (answer === null || source === null) {
      return
    }
    const note = plainResolutionNote(answer, source)
    for (const ref of refs) {
      const current = this.chatLog.findMessage(ref)
      if (current?.kind !== 'prompt') {
        throw new Error(`Message ${ref} is not a prompt`)
      }
      const body: PromptBodyView =
        current.body.kind === 'question'
          ? {
              kind: 'question',
              questions: current.body.questions.map(question => ({
                ...question,
                answered: answer.kind === 'question' ? (answer.answers[question.question] ?? null) : null,
              })),
            }
          : current.body
      this.chatLog.updateMessage(ref, {
        kind: 'prompt',
        promptId: current.promptId,
        title: current.title,
        body,
        status: 'answered',
        resolution: { note, source },
      })
    }
  }

  instructionQueued(instruction: Instruction, session: SessionRow, clientId?: string | null): Message {
    const sourceId = clientId === undefined || clientId === null ? instruction.id : clientSourceId(clientId)
    return this.chatLog.appendMessage(
      this.chatFor(session),
      { kind: 'user_text', text: instruction.text, status: 'queued', instructionId: instruction.id },
      { sourceId },
    )
  }

  instructionDelivered(instructionId: string): void {
    const instruction = this.store.getInstruction(instructionId)
    if (instruction === undefined) {
      return
    }
    this.busyChanged(instruction.sessionId, true)
    const current = this.chatLog.findByInstructionId(instructionId)
    if (current === undefined || current.kind !== 'user_text') {
      return
    }
    if (current.status === 'delivered') {
      return
    }
    this.chatLog.updateMessage(current.id, { kind: 'user_text', text: current.text, status: 'delivered', instructionId: current.instructionId })
  }

  report(session: SessionRow, report: Report): void {
    if (report.kind === 'turn_complete') {
      this.busyChanged(session.id, false)
    }
    if (report.kind === 'session_started') {
      this.appendSystem(session, `Session started in ${session.cwd}`)
      return
    }
    if (report.kind === 'session_ended') {
      this.appendSystem(session, `Session ended (${report.reason})`)
      return
    }
    if (report.text === '' || this.transcriptActive(session.id)) {
      return
    }
    this.chatLog.appendMessage(this.chatFor(session), { kind: 'agent_text', markdown: report.text })
  }

  chatEnded(session: SessionRow): void {
    this.transcriptDetach(session.id)
    const chatId = this.chatIdOf(session.id)
    if (chatId === null || this.chatLog.getChat(chatId) === undefined) {
      return
    }
    this.chatLog.updateChat(chatId, { status: 'ended', busy: false })
  }

  /**
   * The single place that flips a chat's busy flag. A value that is already set emits nothing, and an ended chat never becomes busy.
   * Busy is a stand-in driven by instruction delivery and turn_complete; the transcript reader (a later task) becomes the real source.
   * Until then a delivered instruction with no turn_complete (e.g. an Esc interrupt) leaves the chat busy until the session ends.
   */
  busyChanged(sessionId: string, busy: boolean): void {
    const chatId = this.chatIdOf(sessionId)
    if (chatId === null) {
      return
    }
    const chat = this.chatLog.getChat(chatId)
    if (chat === undefined || chat.busy === busy) {
      return
    }
    if (busy && chat.status === 'ended') {
      return
    }
    this.chatLog.updateChat(chatId, { busy })
  }

  systemMessage(sessionId: string | null, text: string): void {
    if (sessionId === null) {
      this.chatLog.appendMessage(GENERAL_ID, { kind: 'system', text })
      return
    }
    const session = this.store.getSession(sessionId)
    if (session === undefined) {
      throw new Error(`Unknown session ${sessionId}`)
    }
    this.appendSystem(session, text)
  }

  private appendSystem(session: SessionRow, text: string): void {
    this.chatLog.appendMessage(this.chatFor(session), { kind: 'system', text })
  }

  private chatIdOf(sessionId: string): string | null {
    return this.store.getSession(sessionId)?.chatId ?? null
  }

  /** The chat a Session owns: its existing one, else the chat of its thread, else a new one. Idempotent. */
  private chatFor(session: SessionRow): string {
    const owned = this.existingChat(session)
    if (owned !== null) {
      return owned
    }
    const current = this.store.getSession(session.id) ?? session
    if (current.threadId !== null && this.chatLog.getChat(current.threadId) !== undefined) {
      this.chatLog.linkSession(current.threadId, current.id)
      this.store.setSessionChat(current.id, current.threadId)
      return current.threadId
    }
    const id = `c_${crypto.randomUUID()}`
    this.chatLog.createChat({ id, sessionId: current.id, title: threadTitle(current) })
    this.store.setSessionChat(current.id, id)
    this.store.setSessionThread(current.id, id)
    return id
  }
}
