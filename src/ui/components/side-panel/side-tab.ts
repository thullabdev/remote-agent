/** The built-in chat tab's id. The host owns it; extensions register the others. */
export const CHATS_TAB = 'chats'

const STORAGE_KEY = 'remote-agent.side-tab.v1'

/** The tab the side column opens on: the remembered one if it is still registered, otherwise Chats. Never throws. */
export function readSideTab(knownIds: readonly string[], storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    const stored: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')
    return typeof stored === 'string' && (stored === CHATS_TAB || knownIds.includes(stored)) ? stored : CHATS_TAB
  } catch {
    return CHATS_TAB
  }
}

/** Remembers the selected tab on this device. Throws when storage refuses; the caller decides what to show. */
export function saveSideTab(id: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(id))
}
