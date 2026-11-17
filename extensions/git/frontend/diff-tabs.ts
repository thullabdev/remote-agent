import type { OpenDiff } from './open-files.ts'

/** Whether two open diffs name the same file in the same scope and commit. */
export function sameDiff(a: OpenDiff, b: OpenDiff): boolean {
  return a.path === b.path && a.scope === b.scope && a.sha === b.sha
}

/** The tab's label: the file name only, without its folders. */
export function tabName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Adds a diff to the tab list unless it is already there. Either way the returned `active` is that diff's entry. */
export function addOrActivate(list: OpenDiff[], diff: OpenDiff): { list: OpenDiff[]; active: OpenDiff } {
  const existing = list.find(open => sameDiff(open, diff))
  if (existing !== undefined) {
    return { list, active: existing }
  }
  return { list: [...list, diff], active: diff }
}

/**
 * Removes a diff from the tab list. `next` is the nearest remaining tab to where the removed one was (the one that took its place,
 * or else the one before it), or null when no tabs remain.
 */
export function removeTab(list: OpenDiff[], diff: OpenDiff): { list: OpenDiff[]; next: OpenDiff | null } {
  const index = list.findIndex(open => sameDiff(open, diff))
  if (index === -1) {
    return { list, next: list[0] ?? null }
  }
  const remaining = list.filter((_, position) => position !== index)
  const next = remaining[index] ?? remaining[index - 1] ?? null
  return { list: remaining, next }
}

/** Options for leaving the diff panel: back to the chat the diff was opened from, or the chat list when that is unknown. */
export function closeOptionsFor(from: string | undefined): { chatId?: string } {
  if (from === undefined || from === '') {
    return {}
  }
  return { chatId: from }
}
