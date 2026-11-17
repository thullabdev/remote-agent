import type { OpenStateStorage } from '../../../src/ui/components/ui/accordion-state.ts'

export const DRAFT_STORAGE_KEY = 'remote-agent.git.commit-draft.v1'

export type DraftMap = Record<string, string>

/** The key a commit draft is stored under: one draft per branch of one repository. A detached HEAD has its own key. */
export function draftKey(root: string, branch: string | null): string {
  return `${root}#${branch ?? '(detached)'}`
}

/**
 * Every stored draft. Missing, unreadable or malformed storage gives an empty map, and entries that are not strings are dropped.
 * A null storage (no window) also gives an empty map.
 */
export function readDrafts(storage: OpenStateStorage | null): DraftMap {
  if (storage === null) {
    return {}
  }
  try {
    const raw = storage.getItem(DRAFT_STORAGE_KEY)
    if (raw === null) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const drafts: DraftMap = {}
    for (const [draft, message] of Object.entries(parsed)) {
      if (typeof message === 'string') {
        drafts[draft] = message
      }
    }
    return drafts
  } catch {
    return {}
  }
}

/** The stored message for one key, or '' when there is none. */
export function readDraft(storage: OpenStateStorage | null, key: string): string {
  return readDrafts(storage)[key] ?? ''
}

/** Stores the message under a key. A blank message removes the key. Storage errors are ignored: the field still holds the text. */
export function writeDraft(storage: OpenStateStorage | null, key: string, message: string): void {
  if (storage === null) {
    return
  }
  try {
    const drafts = readDrafts(storage)
    if (message.trim() === '') {
      delete drafts[key]
    } else {
      drafts[key] = message
    }
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts))
  } catch {
    // Storage unavailable or full: the draft lives in the field for this session only.
  }
}
