import type { Message } from '../channel/web/protocol.ts'

/**
 * A message to show, in a chat that may not be open yet. `find` locates it among a chat's loaded messages, and `seq` — when known —
 * lets the walk stop as soon as the loaded range covers it.
 */
export type RevealTarget = {
  chatId: string
  seq?: number | null
  find(messages: Message[]): Message | undefined
}

/** What revealing a message needs from the app: the chats it has loaded, and the ways it opens, pages and scrolls them. */
export type RevealDeps = {
  /** Opens the chat. The app loads its newest page in the background, and an already-open chat is left as it is. */
  openChat(chatId: string): void
  /** Whether the chat's newest page has loaded, so its messages can render. */
  isLoaded(chatId: string): boolean
  /** The chat's loaded messages, oldest first. */
  messages(chatId: string): Message[]
  /** Whether older pages exist beyond the loaded ones. */
  hasMore(chatId: string): boolean
  /** The seq before which the chat's history is hidden (its history was cleared), or 0. */
  hiddenBefore(chatId: string): number
  /** Loads the page older than `before` and merges it into the chat. */
  loadOlder(chatId: string, before: number): Promise<void>
  /** Scrolls to the message when it is rendered, and is false while it is not. */
  scrollTo(messageId: string): boolean
  /** Waits for one render, or for a page in flight. */
  wait(): Promise<void>
  /** Told when the message could not be revealed. */
  notFound?(): void
}

/**
 * Waits to spend on a chat's first page and, separately, on a loaded page rendering. With the app's 50 ms tick that is up to five
 * seconds for a slow first load, and half a second for a render.
 */
const LOAD_WAITS = 100
const RENDER_WAITS = 10

/**
 * Opens a chat and scrolls to one of its messages, loading older pages until that message is there. Bookmarks, fork points and
 * Prompts all arrive here: the message they name is often above the newest page, so scrolling to what happens to be loaded is not
 * enough. False when the message cannot be shown, such as one hidden by a cleared history.
 */
export async function revealMessage(deps: RevealDeps, target: RevealTarget): Promise<boolean> {
  deps.openChat(target.chatId)
  await waitFor(deps, () => deps.isLoaded(target.chatId), LOAD_WAITS)

  // A cleared history is hidden from the chat, so no page will ever hold this message.
  if (target.seq != null && target.seq <= deps.hiddenBefore(target.chatId)) {
    deps.notFound?.()
    return false
  }

  // A known seq is the stop: once the loaded range starts at or below it, the page that would hold the message is loaded.
  let found = target.find(deps.messages(target.chatId))
  while (found === undefined && deps.hasMore(target.chatId)) {
    const oldest = deps.messages(target.chatId)[0]?.seq
    if (oldest === undefined || (target.seq != null && target.seq >= oldest)) {
      break
    }
    await deps.loadOlder(target.chatId, oldest)
    // The page is merged by a render of the app, so let that render land before looking for the message again.
    await deps.wait()
    found = target.find(deps.messages(target.chatId))
  }

  if (found !== undefined && (await scrollWhenRendered(deps, found.id))) {
    return true
  }
  deps.notFound?.()
  return false
}

async function waitFor(deps: RevealDeps, ready: () => boolean, waits: number): Promise<void> {
  for (let spent = 0; spent < waits && !ready(); spent += 1) {
    await deps.wait()
  }
}

async function scrollWhenRendered(deps: RevealDeps, messageId: string): Promise<boolean> {
  for (let attempt = 0; attempt < RENDER_WAITS; attempt += 1) {
    if (deps.scrollTo(messageId)) {
      return true
    }
    await deps.wait()
  }
  return false
}
