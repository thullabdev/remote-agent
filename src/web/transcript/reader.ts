import { stat } from 'node:fs/promises'
import type { Log } from '../../bridge/prompts.ts'
import type { Store } from '../../bridge/store.ts'
import { redactSecrets } from '../../core/text.ts'
import type { ChatLog } from '../chat-log.ts'
import type { MessageBody } from '../protocol.ts'
import { parseTranscriptLine, type TranscriptEntry } from './parse.ts'
import { transcriptPath } from './path.ts'

const BATCH_LINES = 200
const POLL_MS = 500
const INSTRUCTION_WINDOW = 20
const NEWLINE = 0x0a
const ENOENT = 'ENOENT'

export type TranscriptReaderDeps = {
  chatLog: ChatLog
  store: Store
  home: string
  log: Log
  /** Called with the new busy value whenever the transcript's busy state changes (the first report always fires). */
  onBusy: (sessionId: string, busy: boolean) => void
  poll?: (run: () => void, ms: number) => () => void
  readFrom?: (path: string, offset: number) => Promise<Uint8Array | null>
  statSize?: (path: string) => Promise<number | null>
}

type Tail = {
  sessionId: string
  chatId: string | null
  path: string | null
  offset: number
  found: boolean
  inFlight: boolean
  /** True while a turn is open: relevant entries came after the last turn_duration marker. */
  open: boolean
  busy: boolean | null
  /** Start times of tool_use entries still waiting for their tool_result, for durationMs. */
  toolStarts: Map<string, number>
  stop: () => void
}

function defaultPoll(run: () => void, ms: number): () => void {
  const timer = setInterval(run, ms)
  return () => {
    clearInterval(timer)
  }
}

async function readFromFile(path: string, offset: number): Promise<Uint8Array | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return null
  }
  return new Uint8Array(await file.slice(offset).arrayBuffer())
}

async function statFileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === ENOENT) {
      return null
    }
    throw error
  }
}

/**
 * Tails each attached Session's transcript file into its chat. Entries are idempotent by source id, so re-reading after a restart or a shrink adds nothing twice.
 * A line without its newline is held back until it is complete, so a half-written line is never stored.
 */
export class TranscriptReader {
  private readonly tails = new Map<string, Tail>()
  private readonly poll: (run: () => void, ms: number) => () => void
  private readonly readFrom: (path: string, offset: number) => Promise<Uint8Array | null>
  private readonly statSize: (path: string) => Promise<number | null>

  constructor(private readonly deps: TranscriptReaderDeps) {
    this.poll = deps.poll ?? defaultPoll
    this.readFrom = deps.readFrom ?? readFromFile
    this.statSize = deps.statSize ?? statFileSize
  }

  /** Starts tailing a Session from the top of its file. Idempotent. The tail waits for the chat and the file if they are not there yet. */
  attach(sessionId: string): void {
    if (this.tails.has(sessionId)) {
      return
    }
    const tail: Tail = {
      sessionId,
      chatId: null,
      path: null,
      offset: 0,
      found: false,
      inFlight: false,
      open: false,
      busy: null,
      toolStarts: new Map(),
      stop: () => {},
    }
    tail.stop = this.poll(() => {
      void this.ingestOnce(sessionId)
    }, POLL_MS)
    this.tails.set(sessionId, tail)
  }

  detach(sessionId: string): void {
    const tail = this.tails.get(sessionId)
    if (tail === undefined) {
      return
    }
    tail.stop()
    this.tails.delete(sessionId)
  }

  /** True only while attached and the transcript file has been found at least once. */
  isActive(sessionId: string): boolean {
    return this.tails.get(sessionId)?.found === true
  }

  /** Reads what is new in the Session's transcript. A tick that overlaps a running one does nothing. */
  async ingestOnce(sessionId: string): Promise<void> {
    const tail = this.tails.get(sessionId)
    if (tail === undefined || tail.inFlight) {
      return
    }
    tail.inFlight = true
    try {
      await this.ingest(tail)
    } catch (error) {
      this.deps.log(`Transcript read failed for session ${sessionId}`, error)
    } finally {
      tail.inFlight = false
    }
  }

  private async ingest(tail: Tail): Promise<void> {
    const session = this.deps.store.getSession(tail.sessionId)
    if (session === undefined) {
      return
    }
    if (tail.chatId === null) {
      if (session.chatId === null) {
        return
      }
      tail.chatId = session.chatId
    }
    const chatId = tail.chatId
    if (tail.path === null) {
      tail.path = transcriptPath(this.deps.home, session.cwd, tail.sessionId)
    }
    const size = await this.statSize(tail.path)
    if (size === null) {
      return
    }
    tail.found = true
    if (size < tail.offset) {
      tail.offset = 0
    }
    if (size === tail.offset) {
      return
    }
    const bytes = await this.readFrom(tail.path, tail.offset)
    if (bytes === null) {
      return
    }
    // Only whole lines: everything up to the last newline. A newline byte never sits inside a multi-byte character.
    const end = bytes.lastIndexOf(NEWLINE)
    if (end === -1) {
      return
    }
    const lines = new TextDecoder().decode(bytes.subarray(0, end)).split('\n')
    for (let start = 0; start < lines.length; start += BATCH_LINES) {
      if (this.tails.get(tail.sessionId) !== tail) {
        return
      }
      for (const line of lines.slice(start, start + BATCH_LINES)) {
        for (const entry of parseTranscriptLine(line)) {
          this.apply(tail, chatId, entry)
        }
      }
      this.reportBusy(tail)
      if (start + BATCH_LINES < lines.length) {
        await Bun.sleep(0)
      }
    }
    tail.offset += end + 1
  }

  private apply(tail: Tail, chatId: string, entry: TranscriptEntry): void {
    const { item, sourceId, at } = entry
    if (item.kind === 'turn_end') {
      tail.open = false
      return
    }
    tail.open = true
    const { chatLog } = this.deps
    if (item.kind === 'agent_text') {
      chatLog.appendMessage(chatId, { kind: 'agent_text', markdown: item.markdown }, { sourceId })
      return
    }
    if (item.kind === 'user_text') {
      this.applyUserText(chatId, sourceId, item.text)
      return
    }
    if (item.kind === 'tool_use') {
      if (at > 0) {
        tail.toolStarts.set(item.toolUseId, at)
      }
      chatLog.appendMessage(
        chatId,
        { kind: 'tool_run', tool: item.tool, input: item.input, result: null, resultTruncated: false, status: 'running', durationMs: null },
        { sourceId },
      )
      return
    }
    this.applyResult(tail, chatId, entry, item)
  }

  // An Instruction the web UI already shows is not shown twice; the transcript holds the same text as the instruction.
  private applyUserText(chatId: string, sourceId: string, text: string): void {
    const { chatLog } = this.deps
    if (chatLog.recentInstructionTexts(chatId, INSTRUCTION_WINDOW).includes(redactSecrets(text))) {
      return
    }
    chatLog.appendMessage(chatId, { kind: 'user_text', text, status: 'delivered', instructionId: null }, { sourceId })
  }

  private applyResult(tail: Tail, chatId: string, entry: TranscriptEntry, item: { toolUseId: string; text: string; isError: boolean }): void {
    const { chatLog } = this.deps
    const started = tail.toolStarts.get(item.toolUseId)
    tail.toolStarts.delete(item.toolUseId)
    const durationMs = started !== undefined && entry.at > 0 ? Math.max(0, entry.at - started) : null
    const status = item.isError ? 'error' : 'done'
    const existing = chatLog.findBySourceId(chatId, entry.sourceId)
    if (existing === undefined) {
      const body: MessageBody = { kind: 'tool_run', tool: 'unknown', input: null, result: item.text, resultTruncated: false, status, durationMs }
      chatLog.appendMessage(chatId, body, { sourceId: entry.sourceId })
      return
    }
    // A run already finished (stored before a restart) is left as it is, so a re-read emits nothing.
    if (existing.kind !== 'tool_run' || existing.status !== 'running') {
      return
    }
    chatLog.updateMessage(existing.id, {
      kind: 'tool_run',
      tool: existing.tool,
      input: existing.input,
      result: item.text,
      resultTruncated: false,
      status,
      durationMs,
    })
  }

  private reportBusy(tail: Tail): void {
    if (tail.busy === tail.open) {
      return
    }
    tail.busy = tail.open
    this.deps.onBusy(tail.sessionId, tail.open)
  }
}
