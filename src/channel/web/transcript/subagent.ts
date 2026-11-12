import { dirname, join } from 'node:path'
import { launchFolderOf } from '../../../bridge/launch-folder.ts'
import type { SessionRow } from '../../../bridge/store.ts'
import { parseTranscriptLine, type TranscriptItem } from './parse.ts'
import { transcriptPath } from './path.ts'

/** The tool a sub-agent ends with: its final report is the message in its input. */
const HANDBACK = 'SubagentHandback'
const SAFE_AGENT_ID = /^[A-Za-z0-9]+$/

/** A sub-agent's activity page: its items in order, and the line to resume from, or null at the end. */
export type SubagentPage = { items: TranscriptItem[]; nextCursor: number | null }

/** Reads a background sub-agent's report and activity from its Session's files. Both are fetched on demand, never with the chat. */
export type SubagentSource = {
  report(session: SessionRow, agentId: string): Promise<string | null>
  activity(session: SessionRow, agentId: string, cursor: number, limit: number): Promise<SubagentPage | null>
}

/** The production source: reads the sub-agent files under the user's Claude folder. */
export function createSubagentSource(home: string): SubagentSource {
  return {
    async report(session, agentId) {
      return readSubagentReport(await subagentFile(home, session, agentId))
    },
    async activity(session, agentId, cursor, limit) {
      return readSubagentActivity(await subagentFile(home, session, agentId), cursor, limit)
    },
  }
}

/**
 * Where Claude Code keeps a sub-agent's own transcript: next to its Session's transcript, in <sessionId>/subagents/agent-<agentId>.jsonl.
 * Throws for an agent id that is not a plain id, since it is joined into a path.
 */
export async function subagentFile(home: string, session: Pick<SessionRow, 'id' | 'cwd' | 'launchCwd'>, agentId: string): Promise<string> {
  if (!SAFE_AGENT_ID.test(agentId)) {
    throw new Error(`agent id "${agentId}" cannot name a transcript file`)
  }
  const transcript = transcriptPath(home, await launchFolderOf(home, session), session.id)
  return join(dirname(transcript), session.id, 'subagents', `agent-${agentId}.jsonl`)
}

/** The sub-agent's final report, or null when the file or its handback is missing. Scans from the end, where the handback is. */
export async function readSubagentReport(file: string): Promise<string | null> {
  const text = await readText(file)
  if (text === null) {
    return null
  }
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (line === undefined || !line.includes(`"name":"${HANDBACK}"`)) {
      continue
    }
    const message = handbackMessage(line)
    if (message !== null) {
      return message
    }
  }
  return null
}

/** One page of the sub-agent's activity from line `cursor`, holding at least `limit` items where the file has them. */
export async function readSubagentActivity(file: string, cursor: number, limit: number): Promise<SubagentPage | null> {
  const text = await readText(file)
  if (text === null) {
    return null
  }
  const lines = text.split('\n')
  const items: TranscriptItem[] = []
  let index = cursor
  while (index < lines.length && items.length < limit) {
    const line = lines[index]
    index += 1
    if (line === undefined || line.trim() === '') {
      continue
    }
    for (const entry of parseTranscriptLine(line, { includeSidechain: true })) {
      if (entry.item.kind !== 'turn_end' && entry.item.kind !== 'ignored_tool_use') {
        items.push(entry.item)
      }
    }
  }
  return { items, nextCursor: index < lines.length ? index : null }
}

function handbackMessage(line: string): string | null {
  try {
    const value = JSON.parse(line) as { message?: { content?: unknown } }
    const content = value.message?.content
    if (!Array.isArray(content)) {
      return null
    }
    for (const block of content) {
      if (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool_use' && (block as { name?: unknown }).name === HANDBACK) {
        const message = ((block as { input?: { message?: unknown } }).input)?.message
        return typeof message === 'string' ? message : null
      }
    }
    return null
  } catch {
    return null
  }
}

async function readText(file: string): Promise<string | null> {
  const handle = Bun.file(file)
  if (!(await handle.exists())) {
    return null
  }
  return handle.text()
}
