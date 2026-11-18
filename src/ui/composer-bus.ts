import type { UploadRef } from '../channel/web/protocol.ts'

type ComposerListener = (ref: UploadRef) => void

/** Listeners per chat id. A chat id has a Set of listeners, and its key is removed when the Set is empty. */
const listeners = new Map<string, Set<ComposerListener>>()
/** Attachments handed over while no composer for their chat was mounted. They are delivered when one mounts. */
const pending = new Map<string, UploadRef[]>()
/** Brings a chat into view. The host registers it; without one, attachments simply wait for the composer. */
let opener: ((chatId: string) => void) | null = null

/**
 * Delivers an attachment to the composer that is showing `chatId`. Returns true when a listener received it now. When no
 * composer for that chat is mounted, the attachment waits and is delivered as soon as one mounts; the result is false.
 */
export function attachToComposer(chatId: string, ref: UploadRef): boolean {
  const set = listeners.get(chatId)
  if (set === undefined || set.size === 0) {
    const waiting = pending.get(chatId) ?? []
    waiting.push(ref)
    pending.set(chatId, waiting)
    return false
  }
  for (const listener of [...set]) {
    listener(ref)
  }
  return true
}

/** Registers a listener for `chatId`. Attachments that waited for that chat are delivered to it at once. The returned function removes it. */
export function subscribeComposer(chatId: string, listener: ComposerListener): () => void {
  let set = listeners.get(chatId)
  if (set === undefined) {
    set = new Set()
    listeners.set(chatId, set)
  }
  set.add(listener)
  const waiting = pending.get(chatId)
  if (waiting !== undefined) {
    pending.delete(chatId)
    for (const ref of waiting) {
      listener(ref)
    }
  }
  return () => {
    const current = listeners.get(chatId)
    if (current === undefined) {
      return
    }
    current.delete(listener)
    if (current.size === 0) {
      listeners.delete(chatId)
    }
  }
}

/** The host registers how to bring a chat into view. Returns a function that removes the registration. */
export function setChatOpener(open: (chatId: string) => void): () => void {
  opener = open
  return () => {
    if (opener === open) {
      opener = null
    }
  }
}

/** Brings `chatId` into view so its composer mounts, if the host has registered how. */
export function openChatForAttach(chatId: string): void {
  opener?.(chatId)
}
