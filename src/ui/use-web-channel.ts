import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chat, Message, ServerEvent } from '../channel/web/protocol.ts'
import type { ApiClient, MessagePage, WebState } from './api.ts'
import { applyServerEvent, createRealtimeState, mergeHistory, type RealtimeState } from './realtime.ts'

export type ConnectionStatus = 'loading' | 'connected' | 'reconnecting' | 'error' | 'resyncing'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.chatId !== 'string') {
    return false
  }
  if (typeof value.seq !== 'number' || typeof value.at !== 'number' || typeof value.kind !== 'string') {
    return false
  }
  return ['user_text', 'agent_text', 'tool_run', 'prompt', 'system', 'command_reply', 'picker'].includes(value.kind)
}

function isChat(value: unknown): value is Chat {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string'
}

function parseServerEvent(raw: string): ServerEvent | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || typeof value.type !== 'string') {
      return null
    }
    if (value.type === 'hello' || value.type === 'resync') {
      return value as unknown as ServerEvent
    }
    if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq)) {
      return null
    }
    if ((value.type === 'message.created' || value.type === 'message.updated') && isMessage(value.message)) {
      return value as unknown as ServerEvent
    }
    if (value.type === 'chat.updated' && isChat(value.chat)) {
      return value as unknown as ServerEvent
    }
    if (
      value.type === 'chat.cleared' &&
      typeof value.chatId === 'string' &&
      typeof value.beforeSeq === 'number'
    ) {
      return value as unknown as ServerEvent
    }
    if (value.type === 'away.updated' && typeof value.away === 'boolean') {
      return value as unknown as ServerEvent
    }
    return null
  } catch {
    return null
  }
}

export function useWebChannel(api: ApiClient, activeChatId: string | null) {
  const [realtime, setRealtime] = useState<RealtimeState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('loading')
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const stateRef = useRef<RealtimeState | null>(null)
  const activeChatRef = useRef(activeChatId)
  const socketRef = useRef<WebSocket | null>(null)

  const updateRealtime = useCallback((update: (current: RealtimeState) => RealtimeState) => {
    setRealtime(current => {
      if (current === null) {
        return current
      }
      const next = update(current)
      stateRef.current = next
      return next
    })
  }, [])

  const sendPresence = useCallback(() => {
    const socket = socketRef.current
    if (socket?.readyState !== WebSocket.OPEN) {
      return
    }
    socket.send(
      JSON.stringify({
        type: 'presence',
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        chatId: activeChatRef.current,
      }),
    )
  }, [])

  useEffect(() => {
    activeChatRef.current = activeChatId
    sendPresence()
  }, [activeChatId, sendPresence])

  useEffect(() => {
    let stopped = false
    let refreshing = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pingTimer: ReturnType<typeof setInterval> | undefined
    let retryCount = 0
    let socket: WebSocket | null = null
    let connect: (after: number) => void = () => {}

    const scheduleReconnect = (after: number) => {
      if (stopped) {
        return
      }
      setStatus('reconnecting')
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retryCount, 5))
      retryCount += 1
      retryTimer = setTimeout(() => connect(stateRef.current?.eventSeq ?? after), delay)
    }

    const pagehide = () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'presence',
          visible: false,
          focused: false,
          chatId: activeChatRef.current,
        }))
      }
    }

    const setState = (next: RealtimeState) => {
      stateRef.current = next
      setRealtime(next)
    }

    connect = (after: number) => {
      if (stopped) {
        return
      }
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${scheme}//${window.location.host}/ws?after=${after}`)
      socketRef.current = socket

      socket.addEventListener('open', () => {
        retryCount = 0
        setError(null)
        setStatus('connected')
        sendPresence()
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }))
          }
        }, 30_000)
      })

      socket.addEventListener('message', event => {
        const serverEvent = typeof event.data === 'string' ? parseServerEvent(event.data) : null
        if (serverEvent === null || stopped) {
          return
        }
        if (serverEvent.type === 'resync') {
          refreshing = true
          setStatus('resyncing')
          socket?.close()
          void api
            .getState()
            .then(next => {
              if (!stopped) {
                setState(createRealtimeState(next))
                refreshing = false
                connect(next.seq)
              }
            })
            .catch(reason => {
              refreshing = false
              setError(reason)
              scheduleReconnect(stateRef.current?.eventSeq ?? after)
            })
          return
        }
        updateRealtime(current => applyServerEvent(current, serverEvent))
      })

      socket.addEventListener('close', () => {
        if (pingTimer !== undefined) {
          clearInterval(pingTimer)
          pingTimer = undefined
        }
        if (socketRef.current === socket) {
          socketRef.current = null
        }
        if (stopped || refreshing) {
          return
        }
        scheduleReconnect(stateRef.current?.eventSeq ?? after)
      })

      socket.addEventListener('error', () => {
        if (!stopped) {
          setStatus('reconnecting')
        }
      })
    }

    const refresh = async () => {
      setStatus('loading')
      setError(null)
      try {
        const initial: WebState = await api.getState()
        if (stopped) {
          return
        }
        setState(createRealtimeState(initial))
        connect(initial.seq)
      } catch (reason) {
        if (!stopped) {
          setError(reason)
          setStatus('error')
        }
      }
    }

    const presenceChanged = () => sendPresence()
    void refresh()
    window.addEventListener('focus', presenceChanged)
    window.addEventListener('blur', presenceChanged)
    document.addEventListener('visibilitychange', presenceChanged)
    window.addEventListener('pagehide', pagehide)
    return () => {
      stopped = true
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
      }
      if (pingTimer !== undefined) {
        clearInterval(pingTimer)
      }
      window.removeEventListener('focus', presenceChanged)
      window.removeEventListener('blur', presenceChanged)
      document.removeEventListener('visibilitychange', presenceChanged)
      window.removeEventListener('pagehide', pagehide)
      socket?.close()
      socketRef.current = null
    }
  }, [api, reloadKey, sendPresence, updateRealtime])

  const loadMessages = useCallback(
    async (chatId: string, before?: number): Promise<MessagePage> => {
      const page = await api.getMessages(chatId, before)
      updateRealtime(current => mergeHistory(current, chatId, page))
      return page
    },
    [api, updateRealtime],
  )

  const mergeMessage = useCallback((message: Message) => {
    updateRealtime(current => mergeHistory(current, message.chatId, {
      messages: [message],
      hasMore: current.hasMore[message.chatId] ?? false,
    }))
  }, [updateRealtime])

  const markRead = useCallback(
    async (chatId: string) => {
      const newest = stateRef.current?.messages[chatId]?.at(-1)
      if (newest !== undefined) {
        await api.markRead(chatId, newest.seq)
      }
    },
    [api],
  )

  return {
    realtime,
    status,
    error,
    reload: () => setReloadKey(value => value + 1),
    loadMessages,
    mergeMessage,
    markRead,
  }
}
