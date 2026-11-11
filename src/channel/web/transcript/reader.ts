import { stat } from 'node:fs/promises'
import type { Log } from '../../../bridge/prompts.ts'
import type { Store } from '../../../bridge/store.ts'
import { redactSecrets } from '../../../core/text.ts'
import type { ChatLog } from '../chat-log.ts'
import type { MessageBody } from '../protocol.ts'
import { parseTranscriptLine, type TranscriptEntry, type TranscriptItem } from './parse.ts'
import { launchFolderOf } from '../../../bridge/launch-folder.ts'
import { transcriptPath } from './path.ts'

const BATCH_LINES = 200
const POLL_MS = 500
const DEFAULT_WINDOW_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_LINE_BYTES = 64 * 1024 * 1024
const NEWLINE = 0x0a
/** An entry this much older than the attach is backfilled history: stored as read. Live entries are newer than that. */
const BACKFILL_SLACK_MS = 2_000
const ENOENT = 'ENOENT'

export type TranscriptReaderDeps = {
  chatLog: ChatLog
  store: Store
  home: string
  log: Log
  /** Called once per read with the new busy value, only when it changed (the first report always fires). */
  onBusy: (sessionId: string, busy: boolean) => void
  poll?: (run: () => void, ms: number) => () => void
  /** Bytes from offset, at most length of them (fewer at end of file). */
  readFrom?: (path: string, offset: number, length: number) => Promise<Uint8Array | null>
  statSize?: (path: string) => Promise<number | null>
  /** The most bytes requested in one read. Tests lower it. */
  windowBytes?: number
  /** A line longer than this is logged and skipped. */
  maxLineBytes?: number
  now?: () => number
}

type Tail = {
  sessionId: string
  chatId: string | null
  path: string | null
  /** The history a resumed Session copies from, until its own transcript exists. Null for any other Session. */
  source: string | null
  /** True while the lines come from the source history rather than the Session's own transcript. */
  fromSource: boolean
  offset: number
  found: boolean
  inFlight: boolean
  /** When the reader attached this Session: entries older than this (minus a slack) are backfilled history. */
  attachedAt: number
  /** True once the reason an id cannot be tailed has been logged, so each tick does not repeat it. */
  pathLogged: boolean
  /** Set once the reader has logged that the transcript file is missing, so a session waiting for its first turn logs once. */
  missingLogged: boolean
  /** True while skipping the rest of an oversized line, up to its newline. */
  skipping: boolean
  /** True while a turn is open: relevant entries came after the last turn_duration or interrupt marker. */
  open: boolean
  busy: boolean | null
  /** Start times of tool_use entries still waiting for their tool_result, for durationMs. */
  toolStarts: Map<string, number>
  /** AskUserQuestion tool_use ids: their tool_result is dropped. Rebuilt from offset 0 after a restart. */
  ignored: Set<string>
  stop: () => void
}

function defaultPoll(run: () => void, ms: number): () => void {
  const timer = setInterval(run, ms)
  return () => {
    clearInterval(timer)
  }
}

async function readFromFile(path: string, offset: number, length: number): Promise<Uint8Array | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return null
  }
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
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
 * The file is read in windows; only whole lines (up to a newline) are processed, so a half-written line is never stored.
 */
export class TranscriptReader {
  private readonly tails = new Map<string, Tail>()
  /** Source histories named before their Session's reader attached. */
  private readonly sources = new Map<string, string>()
  private readonly poll: (run: () => void, ms: number) => () => void
  private readonly readFrom: (path: string, offset: number, length: number) => Promise<Uint8Array | null>
  private readonly statSize: (path: string) => Promise<number | null>
  private readonly windowBytes: number
  private readonly maxLineBytes: number
  private readonly now: () => number

  constructor(private readonly deps: TranscriptReaderDeps) {
    this.now = deps.now ?? Date.now
    this.poll = deps.poll ?? defaultPoll
    this.readFrom = deps.readFrom ?? readFromFile
    this.statSize = deps.statSize ?? statFileSize
    this.windowBytes = deps.windowBytes ?? DEFAULT_WINDOW_BYTES
    this.maxLineBytes = deps.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES
  }

  /** Starts tailing a Session from the top of its file. Idempotent. The tail waits for the chat and the file if they are not there yet. */
  /**
   * Tells the reader that a Session was started from an earlier history. Claude Code keeps that history in memory and writes the
   * Session's own transcript only at its first turn, so until then the history is read from the source transcript. The copied
   * lines keep their ids, so reading them again later adds nothing.
   */
  attachSource(sessionId: string, historyId: string): void {
    this.sources.set(sessionId, historyId)
    const tail = this.tails.get(sessionId)
    if (tail !== undefined) {
      tail.source = historyId
    }
  }

  attach(sessionId: string): void {
    if (this.tails.has(sessionId)) {
      return
    }
    this.deps.log(`Transcript reader attached to session ${sessionId}`)
    const tail: Tail = {
      sessionId,
      chatId: null,
      path: null,
      source: this.sources.get(sessionId) ?? null,
      fromSource: false,
      offset: 0,
      found: false,
      inFlight: false,
      attachedAt: this.now(),
      pathLogged: false,
      missingLogged: false,
      skipping: false,
      open: false,
      busy: null,
      toolStarts: new Map(),
      ignored: new Set(),
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
    tail.toolStarts.clear()
    tail.ignored.clear()
    this.tails.delete(sessionId)
  }

  /** Stops every tail and its poll timer. Called at shutdown. */
  close(): void {
    for (const sessionId of [...this.tails.keys()]) {
      this.detach(sessionId)
    }
  }

  /** True only while attached and the transcript file has been found at least once. */
  isActive(sessionId: string): boolean {
    return this.tails.get(sessionId)?.found === true
  }

  /** Reads everything new in the Session's transcript. A tick that overlaps a running one does nothing. */
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
      try {
        tail.path = transcriptPath(this.deps.home, await launchFolderOf(this.deps.home, session), tail.sessionId)
      } catch (error) {
        if (!tail.pathLogged) {
          tail.pathLogged = true
          this.deps.log(`Session ${tail.sessionId} has no transcript file to tail`, error)
        }
        return
      }
    }
    const ownPath = tail.path
    const ownSize = await this.statSize(ownPath)
    // A resumed Session reads its history from the source until its own transcript exists; then it reads its own from the start,
    // and the copied lines are skipped because they were stored already.
    const historyId = tail.source
    const fromSource = ownSize === null && historyId !== null
    if (ownSize !== null) {
      tail.source = null
    }
    const path = fromSource ? this.historyPath(session.cwd, historyId) : ownPath
    if (path === null) {
      return
    }
    const size = fromSource ? await this.statSize(path) : ownSize
    if (fromSource !== tail.fromSource) {
      tail.fromSource = fromSource
      tail.offset = 0
      tail.skipping = false
    }
    if (size === null) {
      if (!tail.missingLogged) {
        tail.missingLogged = true
        this.deps.log(`Transcript of session ${tail.sessionId} not found yet at ${path}; waiting for it`)
      }
      return
    }
    if (!tail.found) {
      this.deps.log(`Transcript of session ${tail.sessionId} found at ${path} (${size} bytes); reading it`)
    }
    tail.found = true
    if (size < tail.offset) {
      tail.offset = 0
      tail.skipping = false
    }
    let windowLength = this.windowBytes
    let read = false
    while (tail.offset < size) {
      if (this.tails.get(tail.sessionId) !== tail) {
        return
      }
      const bytes = await this.readFrom(path, tail.offset, windowLength)
      if (bytes === null || bytes.length === 0) {
        break
      }
      if (tail.skipping) {
        const newline = bytes.indexOf(NEWLINE)
        if (newline === -1) {
          tail.offset += bytes.length
        } else {
          tail.offset += newline + 1
          tail.skipping = false
          windowLength = this.windowBytes
        }
        continue
      }
      const end = bytes.lastIndexOf(NEWLINE)
      if (end === -1) {
        if (tail.offset + bytes.length >= size) {
          break
        }
        if (windowLength < this.maxLineBytes) {
          windowLength = Math.min(windowLength * 2, this.maxLineBytes)
          continue
        }
        this.deps.log(`Transcript line at byte ${tail.offset} of session ${tail.sessionId} is over ${this.maxLineBytes} bytes; skipped`)
        tail.skipping = true
        tail.offset += bytes.length
        continue
      }
      const complete = await this.applyLines(tail, chatId, new TextDecoder().decode(bytes.subarray(0, end)).split('\n'))
      if (!complete) {
        return
      }
      tail.offset += end + 1
      windowLength = this.windowBytes
      read = true
    }
    if (read) {
      this.reportBusy(tail)
    }
  }

  /** The source history's transcript for a Session in `cwd`, or null when the id cannot name a file. */
  private historyPath(cwd: string, historyId: string | null): string | null {
    if (historyId === null) {
      return null
    }
    try {
      return transcriptPath(this.deps.home, cwd, historyId)
    } catch {
      return null
    }
  }

  /** Applies the lines in batches, yielding between them. False when the Session was detached meanwhile. */
  private async applyLines(tail: Tail, chatId: string, lines: string[]): Promise<boolean> {
    for (let start = 0; start < lines.length; start += BATCH_LINES) {
      if (this.tails.get(tail.sessionId) !== tail) {
        return false
      }
      for (const line of lines.slice(start, start + BATCH_LINES)) {
        for (const entry of parseTranscriptLine(line)) {
          try {
            this.apply(tail, chatId, entry)
          } catch (error) {
            this.deps.log(`Transcript entry ${entry.sourceId} could not be stored; skipped`, error)
          }
        }
      }
      if (start + BATCH_LINES < lines.length) {
        await Bun.sleep(0)
      }
    }
    return true
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
      chatLog.appendMessage(chatId, { kind: 'agent_text', markdown: item.markdown }, this.stamp(tail, at, sourceId))
      return
    }
    if (item.kind === 'user_text') {
      this.applyUserText(tail, chatId, entry, item.text)
      return
    }
    if (item.kind === 'ignored_tool_use') {
      tail.ignored.add(item.toolUseId)
      return
    }
    if (item.kind === 'tool_use') {
      if (at > 0) {
        tail.toolStarts.set(item.toolUseId, at)
      }
      chatLog.appendMessage(
        chatId,
        { kind: 'tool_run', tool: item.tool, input: item.input, result: null, resultTruncated: false, status: 'running', durationMs: null },
        this.stamp(tail, at, sourceId),
      )
      return
    }
    if (tail.ignored.delete(item.toolUseId)) {
      return
    }
    this.applyResult(tail, chatId, entry, item)
  }

  /**
   * A transcript user line is either a prompt typed in the terminal, or the echo of an Instruction the web UI already shows.
   * Each Instruction matches at most one line, the oldest first; a line handled once (by its source id) is never handled again.
   */
  private applyUserText(tail: Tail, chatId: string, entry: TranscriptEntry, text: string): void {
    const { chatLog } = this.deps
    const { sourceId } = entry
    if (chatLog.isClaimed(chatId, sourceId)) {
      return
    }
    const instruction = chatLog.findUnclaimedInstruction(chatId, redactSecrets(text))
    if (instruction !== undefined) {
      chatLog.claim(chatId, `instr:${instruction.id}`)
      chatLog.claim(chatId, sourceId)
      return
    }
    chatLog.appendMessage(chatId, { kind: 'user_text', text, status: 'delivered', instructionId: null }, this.stamp(tail, entry.at, sourceId))
    chatLog.claim(chatId, sourceId)
  }

  /** A transcript message keeps the time of its entry. An entry older than the attach is history, stored as read. */
  private stamp(tail: Tail, at: number, sourceId: string): { sourceId: string; at?: number; history: boolean } {
    if (at <= 0) {
      return { sourceId, history: false }
    }
    return { sourceId, at, history: at < tail.attachedAt - BACKFILL_SLACK_MS }
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
      chatLog.appendMessage(chatId, body, this.stamp(tail, entry.at, entry.sourceId))
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
