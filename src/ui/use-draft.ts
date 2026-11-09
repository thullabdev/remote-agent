import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { UploadRef } from '../channel/web/protocol.ts'
import type { ApiClient } from './api.ts'

/** How long the composer waits after the last edit before saving the draft. */
export const DRAFT_SAVE_DELAY_MS = 800

export type DraftApi = Pick<ApiClient, 'getDraft' | 'saveDraft'>

type Snapshot = { text: string; attachments: UploadRef[] }

function keyOf(snapshot: Snapshot): string {
  return JSON.stringify(snapshot)
}

/**
 * The composer's unsent text and attachments for one chat. The draft is kept on the Bridge, so it follows
 * the chat to another device. Callers must key the composer by chat, so each chat gets its own hook instance.
 * Edits are saved after a short pause; a pending save is sent at once when the page is hidden or the composer unmounts.
 */
export function useDraft(api: DraftApi, chatId: string): {
  text: string
  setText: Dispatch<SetStateAction<string>>
  attachments: UploadRef[]
  setAttachments: Dispatch<SetStateAction<UploadRef[]>>
} {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<UploadRef[]>([])
  const [loaded, setLoaded] = useState(false)
  // Until the saved draft has loaded, nothing is written, so an empty first render cannot erase it.
  const saved = useRef(keyOf({ text: '', attachments: [] }))
  const latest = useRef({ chatId, text, attachments, loaded })

  useEffect(() => {
    latest.current = { chatId, text, attachments, loaded }
  })

  const flush = useCallback(() => {
    const snapshot = latest.current
    if (!snapshot.loaded) {
      return
    }
    const key = keyOf(snapshot)
    if (key === saved.current) {
      return
    }
    saved.current = key
    api.saveDraft(snapshot.chatId, { text: snapshot.text, attachments: snapshot.attachments }).catch(() => {
      // A failed save is retried by the next edit; the composer keeps working without it.
    })
  }, [api])

  useEffect(() => {
    let active = true
    api
      .getDraft(chatId)
      .then(({ draft }) => {
        if (active && draft !== null) {
          // Only fill an empty composer, so text typed while the draft loads is never overwritten.
          setText(current => (current === '' ? draft.text : current))
          setAttachments(current => (current.length === 0 ? draft.attachments : current))
        }
      })
      .catch(() => {
        // No draft is shown when the Bridge cannot be reached; the composer still works.
      })
      .finally(() => {
        if (active) {
          setLoaded(true)
        }
      })
    return () => {
      active = false
    }
  }, [api, chatId])

  useEffect(() => {
    if (!loaded || keyOf({ text, attachments }) === saved.current) {
      return
    }
    const timer = setTimeout(flush, DRAFT_SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, attachments, loaded, flush])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [flush])

  return { text, setText, attachments, setAttachments }
}
