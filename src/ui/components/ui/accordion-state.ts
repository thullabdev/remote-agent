export type OpenStateStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void }

const STORAGE_KEY = 'remote-agent.accordion.v1'

type OpenMap = Record<string, boolean>

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

export function readOpen(storage: OpenStateStorage | null, id: string, fallback: boolean): boolean {
  if (!storage) {
    return fallback
  }
  const value = readMap(storage)[id]
  return typeof value === 'boolean' ? value : fallback
}

export function writeOpen(storage: OpenStateStorage | null, id: string, open: boolean): void {
  if (!storage) {
    return
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...readMap(storage), [id]: open }))
  } catch {
    // Storage unavailable or full: the accordion still works for this session.
  }
}
