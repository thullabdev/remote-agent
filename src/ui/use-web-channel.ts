import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chat, Message, ServerEvent } from '../channel/web/protocol.ts'
import type { ApiClient, MessagePage, WebState } from './api.ts'
import { applyServerEvent, createRealtimeState, mergeHistory, type RealtimeState } from './realtime.ts'
import { Liveness } from './liveness.ts'

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

function isUsageView(value: unknown): boolean {
  return isRecord(value) && 'accounts' in value && Array.isArray(value.accounts) && isRecord(value.chats)
}

export function parseServerEvent(raw: string): ServerEvent | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || typeof value.type !== 'string') {
      return null
    }
    if (value.type === 'hello' || value.type === 'resync') {
      return value as unknown as ServerEvent
    }
    if (value.type === 'usage.updated') {
      return isUsageView(value.usage) ? (value as unknown as ServerEvent) : null
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
  const reconnectNowRef = useRef<() => void>(() => {})

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
    let retryCount = 0
    let liveness: Liveness | null = null
    let abandonCurrent: (() => void) | null = null
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
      const current = new WebSocket(`${scheme}//${window.location.host}/ws?after=${after}`)
      socket = current
      socketRef.current = current
      let monitor: Liveness | null = null
      let abandoned = false

      /** The connection looks open but has gone quiet: drop it and reconnect at once, replaying what was missed. */
      const abandon = () => {
        abandoned = true
        if (liveness === monitor) {
          liveness = null
        }
        if (socketRef.current === current) {
          socketRef.current = null
        }
        try {
          current.close()
        } catch {
          // Already closed: nothing to do.
        }
        if (stopped || refreshing) {
          return
        }
        setStatus('reconnecting')
        retryCount = 0
        connect(stateRef.current?.eventSeq ?? after)
      }

      abandonCurrent = abandon

      current.addEventListener('open', () => {
        retryCount = 0
        setError(null)
        setStatus('connected')
        sendPresence()
        monitor = new Liveness({
          now: Date.now,
          send: () => {
            if (current.readyState === WebSocket.OPEN) {
              current.send(JSON.stringify({ type: 'ping' }))
            }
          },
          onDead: abandon,
          schedule: (fn, ms) => {
            const timer = setTimeout(fn, ms)
            return () => clearTimeout(timer)
          },
          repeat: (fn, ms) => {
            const timer = setInterval(fn, ms)
            return () => clearInterval(timer)
          },
        })
        liveness = monitor
        monitor.start()
      })

      current.addEventListener('message', event => {
        if (abandoned) {
          return
        }
        // Anything from the server, a pong included, shows the connection is alive.
        monitor?.heard()
        const serverEvent = typeof event.data === 'string' ? parseServerEvent(event.data) : null
        if (serverEvent === null || stopped) {
          return
        }
        if (serverEvent.type === 'resync') {
          refreshing = true
          setStatus('resyncing')
          monitor?.stop()
          current.close()
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
        updateRealtime(state => applyServerEvent(state, serverEvent))
      })

      current.addEventListener('close', () => {
        monitor?.stop()
        if (liveness === monitor) {
          liveness = null
        }
        if (socketRef.current === current) {
          socketRef.current = null
        }
        if (abandoned || stopped || refreshing) {
          return
        }
        scheduleReconnect(stateRef.current?.eventSeq ?? after)
      })

      current.addEventListener('error', () => {
        if (!abandoned && !stopped) {
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

    /**
     * Reconnects now, without waiting out the retry delay. A no-op while a socket is open or before the first load. A socket that is
     * stuck connecting or closing (a dropped network can leave it there for minutes) is abandoned and replaced.
     */
    const reconnectNow = () => {
      if (stopped || refreshing || stateRef.current === null) {
        return
      }
      const existing = socketRef.current
      if (existing !== null) {
        if (existing.readyState !== WebSocket.OPEN) {
          abandonCurrent?.()
        }
        return
      }
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      retryCount = 0
      setStatus('reconnecting')
      connect(stateRef.current.eventSeq)
    }
    reconnectNowRef.current = reconnectNow

    const presenceChanged = () => sendPresence()
    /** The user is back, or the network is: reconnect now if the socket is gone, probe it if it has been quiet. */
    const returned = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      reconnectNow()
      liveness?.returned()
    }
    void refresh()
    window.addEventListener('focus', presenceChanged)
    window.addEventListener('blur', presenceChanged)
    document.addEventListener('visibilitychange', presenceChanged)
    document.addEventListener('visibilitychange', returned)
    window.addEventListener('online', returned)
    window.addEventListener('pageshow', returned)
    window.addEventListener('pagehide', pagehide)
    return () => {
      stopped = true
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
      }
      liveness?.stop()
      reconnectNowRef.current = () => {}
      window.removeEventListener('focus', presenceChanged)
      window.removeEventListener('blur', presenceChanged)
      document.removeEventListener('visibilitychange', presenceChanged)
      document.removeEventListener('visibilitychange', returned)
      window.removeEventListener('online', returned)
      window.removeEventListener('pageshow', returned)
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
    /** Tries the connection again now: a full reload if the app never loaded, otherwise a reconnect that skips the retry delay. */
    retry: () => {
      if (stateRef.current === null) {
        setReloadKey(value => value + 1)
      } else {
        reconnectNowRef.current()
      }
    },
    loadMessages,
    mergeMessage,
    markRead,
  }
}
