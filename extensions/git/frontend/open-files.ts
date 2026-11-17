import type { OpenStateStorage } from '../../../src/ui/components/ui/accordion-state.ts'

export type OpenDiff = { path: string; scope: 'staged' | 'unstaged' | 'commit'; sha?: string }

const STORAGE_KEY = 'remote-agent.git.open-files.v1'
const SCOPES: readonly string[] = ['staged', 'unstaged', 'commit']

type OpenMap = Record<string, OpenDiff[]>

function isOpenDiff(value: unknown): value is OpenDiff {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const entry = value as { path?: unknown; scope?: unknown }
  return typeof entry.path === 'string' && typeof entry.scope === 'string' && SCOPES.includes(entry.scope)
}

function readMap(storage: OpenStateStorage): OpenMap {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as OpenMap
    }
    return {}
  } catch {
    return {}
  }
}

export function readOpenDiffs(storage: OpenStateStorage | null, chatId: string): OpenDiff[] {
  if (!storage) {
    return []
  }
  const entries: unknown = readMap(storage)[chatId]
  if (!Array.isArray(entries)) {
    return []
  }
  return entries.filter(isOpenDiff)
}

export function writeOpenDiffs(storage: OpenStateStorage | null, chatId: string, diffs: OpenDiff[]): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...readMap(storage), [chatId]: diffs }))
  } catch {
    // Storage unavailable or full: the open diffs still work for this session.
  }
}
