import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { redactSecrets, truncate } from '../core/text.ts'

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const PREVIEW_BYTES = 64 * 1024
const ENOENT = 'ENOENT'

export type SessionHistory = { id: string; label: string }

function firstPrompt(contents: string): string {
  for (const line of contents.split('\n')) {
    try {
      const entry: unknown = JSON.parse(line)
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        continue
      }
      const record = entry as Record<string, unknown>
      if (record.type !== 'user' || record.message === null || typeof record.message !== 'object') {
        continue
      }
      const message = record.message as Record<string, unknown>
      if (typeof message.content === 'string' && message.content.trim() !== '') {
        return message.content
      }
      if (Array.isArray(message.content)) {
        const text = message.content
          .flatMap(block =>
            block !== null && typeof block === 'object' && !Array.isArray(block) &&
            (block as Record<string, unknown>).type === 'text' &&
            typeof (block as Record<string, unknown>).text === 'string'
              ? [(block as Record<string, unknown>).text as string]
              : [],
          )
          .join(' ')
        if (text.trim() !== '') {
          return text
        }
      }
    } catch {
      // Partial or malformed lines are ignored while the transcript is read.
    }
  }
  return ''
}

/** Lists the most recently modified Claude transcripts for this exact working directory. */
export async function listSessionHistories(home: string, cwd: string, limit = 20): Promise<SessionHistory[]> {
  const directory = join(home, '.claude', 'projects', cwd.replace(/[/.]/g, '-'))
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === ENOENT) {
      return []
    }
    throw error
  }

  const histories = await Promise.all(
    entries.flatMap(entry => {
      const id = entry.name.endsWith('.jsonl') ? entry.name.slice(0, -'.jsonl'.length) : ''
      if (!entry.isFile() || !SAFE_SESSION_ID.test(id)) {
        return []
      }
      return [
        (async (): Promise<(SessionHistory & { modifiedAt: number }) | null> => {
          const path = join(directory, entry.name)
          try {
            const details = await stat(path)
            if (!details.isFile()) {
              return null
            }
            const prompt = firstPrompt(await Bun.file(path).slice(0, PREVIEW_BYTES).text())
            const preview = truncate(redactSecrets(prompt.replace(/\s+/g, ' ').trim() || id), 48)
            return {
              id,
              label: `${new Date(details.mtimeMs).toISOString().slice(0, 10)} · ${preview}`,
              modifiedAt: details.mtimeMs,
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === ENOENT) {
              return null
            }
            throw error
          }
        })(),
      ]
    }),
  )

  return histories
    .filter((history): history is SessionHistory & { modifiedAt: number } => history !== null)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, limit)
    .map(({ id, label }) => ({ id, label }))
}
