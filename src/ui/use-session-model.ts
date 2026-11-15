import { useEffect, useState } from 'react'
import type { ApiClient } from './api.ts'

export type SessionModelApi = Pick<ApiClient, 'resumeModel'>

/**
 * The full model id the chat's Session last ran on, or null when unknown (before its first reply, or for General).
 * It is read again whenever `refreshKey` changes, so callers pass something that changes after each turn.
 * The answer is tagged with its chat, so a value from the previous chat is never shown for this one.
 */
export function useSessionModel(api: SessionModelApi, chatId: string | null, refreshKey: string): string | null {
  const [known, setKnown] = useState<{ chatId: string; model: string | null } | null>(null)

  useEffect(() => {
    if (chatId === null) {
      return
    }
    let current = true
    api
      .resumeModel(chatId)
      .then(result => {
        if (current) {
          setKnown({ chatId, model: result.model })
        }
      })
      .catch(() => {
        if (current) {
          setKnown({ chatId, model: null })
        }
      })
    return () => {
      current = false
    }
  }, [api, chatId, refreshKey])

  return chatId !== null && known?.chatId === chatId ? known.model : null
}
