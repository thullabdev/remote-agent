import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** The transcript cannot be cut at the chosen message: the file is unreadable or the message's uuid is not in it. */
export class TranscriptCutError extends Error {}

type TranscriptLine = { [key: string]: unknown }

function parseRecord(line: string): TranscriptLine | null {
  try {
    const value: unknown = JSON.parse(line)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    return value as TranscriptLine
  } catch {
    return null
  }
}

/** The line Claude Code writes when the user interrupts a turn. The transcript parser reads it as the end of the turn. */
function interruptMarker(sessionId: string): TranscriptLine {
  return {
    type: 'user',
    uuid: randomUUID(),
    sessionId,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    message: { role: 'user', content: '[Request interrupted by user]' },
  }
}

/** The copy names its own session under both spellings Claude uses: `sessionId` and `session_id`. */
function rebind(record: TranscriptLine, sessionId: string): TranscriptLine {
  const next = { ...record }
  if ('sessionId' in record) {
    next.sessionId = sessionId
  }
  if ('session_id' in record) {
    next.session_id = sessionId
  }
  return next
}

/**
 * Copies a Claude transcript up to and including the line whose uuid is `uuid`, into `destination`, so a session resumed from the copy
 * writes to its own id. Every copied line names `sessionId`. After the chosen line, only system lines are copied, up to and including
 * the turn_duration line that closes the turn. Any other line ends the cut, so nothing from the next turn is carried over.
 * When the turn was not closed in the copy (the reply was mid-turn), the copy ends with Claude's interrupt marker, the line Claude
 * writes on Esc, so the copy opens idle rather than as a turn still in progress.
 * Lines that do not parse are copied unchanged. Nothing is written when the uuid is not found.
 * The destination folder is created when it does not exist yet.
 * The whole file is read into memory; transcripts are read this way elsewhere in the web channel.
 */
export async function cutTranscript(input: { source: string; destination: string; uuid: string; sessionId: string }): Promise<void> {
  let contents: string
  try {
    contents = await readFile(input.source, 'utf8')
  } catch (error) {
    throw new TranscriptCutError(`cannot read the transcript: ${(error as Error).message}`)
  }
  const kept: string[] = []
  let found = false
  let closed = false
  for (const line of contents.split('\n')) {
    if (line.trim() === '') {
      continue
    }
    const record = parseRecord(line)
    if (found) {
      if (record === null || record.type !== 'system') {
        break
      }
      kept.push(JSON.stringify(rebind(record, input.sessionId)))
      if (record.subtype === 'turn_duration') {
        closed = true
        break
      }
      continue
    }
    if (record === null) {
      kept.push(line)
      continue
    }
    kept.push(JSON.stringify(rebind(record, input.sessionId)))
    if (record.uuid === input.uuid) {
      found = true
    }
  }
  if (!found) {
    throw new TranscriptCutError(`message ${input.uuid} is not in the transcript`)
  }
  if (!closed) {
    kept.push(JSON.stringify(interruptMarker(input.sessionId)))
  }
  const temporary = `${input.destination}.tmp`
  await mkdir(dirname(input.destination), { recursive: true })
  await writeFile(temporary, kept.join('\n') + '\n')
  await rename(temporary, input.destination)
}
