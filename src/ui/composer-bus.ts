import type { UploadRef } from '../channel/web/protocol.ts'
import type { CommentBundle } from './comment-bundle.ts'

/** A composer's answer: true when it took the attachment, false when it is full. */
type ComposerListener = (ref: UploadRef) => boolean

/** What happened to an attachment: shown now, waiting for the composer to mount, or refused because the composer is full. */
export type AttachResult = 'delivered' | 'queued' | 'full'

/** Listeners per chat id. A chat id has a Set of listeners, and its key is removed when the Set is empty. */
const listeners = new Map<string, Set<ComposerListener>>()
/** Attachments handed over while no composer for their chat was mounted. They are delivered when one mounts. */
const pending = new Map<string, UploadRef[]>()
/** Brings a chat into view. The host registers it; without one, attachments simply wait for the composer. */
let opener: ((chatId: string) => void) | null = null

/**
 * Delivers an attachment to the composer that is showing `chatId`. When no composer for that chat is mounted, the attachment
 * waits and is delivered as soon as one mounts ('queued'). When the composer is full it is refused ('full').
 */
export function attachToComposer(chatId: string, ref: UploadRef): AttachResult {
  const set = listeners.get(chatId)
  if (set === undefined || set.size === 0) {
    const waiting = pending.get(chatId) ?? []
    waiting.push(ref)
    pending.set(chatId, waiting)
    return 'queued'
  }
  let taken = false
  for (const listener of [...set]) {
    taken = listener(ref) || taken
  }
  return taken ? 'delivered' : 'full'
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
    const refused = waiting.filter(ref => !listener(ref))
    if (refused.length > 0) {
      pending.set(chatId, refused)
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

/** A composer's bundle listener. Bundles are never refused, so it returns nothing. */
type BundleListener = (bundle: CommentBundle) => void

/** Bundle listeners per chat id, removed with their chat's key when the set is empty. */
const bundleListeners = new Map<string, Set<BundleListener>>()
/** Bundles handed over while no composer for their chat was mounted. They are delivered when one mounts. */
const pendingBundles = new Map<string, CommentBundle[]>()

/**
 * Hands a comment bundle to the composer showing `chatId`, which shows it as a card and sends it with the next message. When no
 * composer for that chat is mounted the bundle waits ('queued'). A bundle is never refused.
 */
export function attachCommentsToComposer(chatId: string, bundle: CommentBundle): AttachResult {
  const set = bundleListeners.get(chatId)
  if (set === undefined || set.size === 0) {
    const waiting = pendingBundles.get(chatId) ?? []
    waiting.push(bundle)
    pendingBundles.set(chatId, waiting)
    return 'queued'
  }
  for (const listener of [...set]) {
    listener(bundle)
  }
  return 'delivered'
}

/** Registers a bundle listener for `chatId`. Bundles that waited for that chat are delivered to it at once. The returned function removes it. */
export function subscribeBundles(chatId: string, listener: BundleListener): () => void {
  let set = bundleListeners.get(chatId)
  if (set === undefined) {
    set = new Set()
    bundleListeners.set(chatId, set)
  }
  set.add(listener)
  const waiting = pendingBundles.get(chatId)
  if (waiting !== undefined) {
    pendingBundles.delete(chatId)
    for (const bundle of waiting) {
      listener(bundle)
    }
  }
  return () => {
    const current = bundleListeners.get(chatId)
    if (current === undefined) {
      return
    }
    current.delete(listener)
    if (current.size === 0) {
      bundleListeners.delete(chatId)
    }
  }
}
