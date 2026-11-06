import { AlertCircle, ArrowRight, LoaderCircle, LockKeyhole, MessageSquareText, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, Message } from '../channel/web/protocol.ts'
import { createApiClient, RequestError } from './api.ts'
import { Button } from './components/ui/button.tsx'
import { ChatComposer } from './components/chat-composer.tsx'
import { ChatHeader } from './components/chat-header.tsx'
import { ChatInfo } from './components/chat-info.tsx'
import { ChatList } from './components/chat-list.tsx'
import { MessageFeed } from './components/message-feed.tsx'
import { NewSessionDialog } from './components/new-session-dialog.tsx'
import { SettingsDialog } from './components/settings-dialog.tsx'
import { readPreferences, savePreferences, type Preferences } from './preferences.ts'
import { applyAppearance } from './appearance.ts'
import { usePushSubscription } from './use-push-subscription.ts'
import { useWebChannel } from './use-web-channel.ts'

type PendingMessage = {
  clientId: string
  message: Message
  error: string | null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function App() {
  const api = useMemo(() => createApiClient(), [])
  const [activeChatId, setActiveChatId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('chat'))
  const [infoOpen, setInfoOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [preferences, setPreferences] = useState<Preferences>(() => readPreferences())
  const [pendingMessages, setPendingMessages] = useState<Record<string, PendingMessage[]>>({})
  const [busyChatIds, setBusyChatIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { realtime, status, error, reload, loadMessages, mergeMessage, markRead } = useWebChannel(api, activeChatId)
  const push = usePushSubscription(api)

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current)
    }
    toastTimer.current = setTimeout(() => setToast(null), 4200)
  }, [])

  const handleError = useCallback((reason: unknown) => {
    if (reason instanceof RequestError && reason.accessDenied) {
      setAccessDenied(true)
    }
    notify(errorText(reason))
  }, [notify])

  const chats = realtime?.chats ?? []
  const activeChat = chats.find(chat => chat.id === activeChatId) ?? null
  const messages = activeChatId === null ? [] : realtime?.messages[activeChatId] ?? []
  const pendingForChat = activeChatId === null ? [] : pendingMessages[activeChatId] ?? []

  useEffect(() => {
    if (error instanceof RequestError && error.accessDenied) {
      setAccessDenied(true)
    }
  }, [error])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => applyAppearance(preferences, media.matches)
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [preferences])

  useEffect(() => {
    try {
      savePreferences(preferences)
    } catch {
      notify('Could not save appearance settings on this device.')
    }
  }, [preferences, notify])

  useEffect(() => {
    if (activeChatId !== null && realtime !== null && !chats.some(chat => chat.id === activeChatId)) {
      setActiveChatId(null)
    }
  }, [activeChatId, chats, realtime])

  useEffect(() => {
    const handlePopState = () => {
      setActiveChatId(new URLSearchParams(window.location.search).get('chat'))
      setInfoOpen(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (activeChatId === null || realtime === null) {
      return
    }
    if (!realtime.loadedChats.has(activeChatId)) {
      void loadMessages(activeChatId).catch(handleError)
    }
  }, [activeChatId, handleError, loadMessages, realtime?.loadedChats])

  useEffect(() => {
    if (activeChatId === null || !realtime?.loadedChats.has(activeChatId) || document.visibilityState !== 'visible') {
      return
    }
    void markRead(activeChatId).catch(handleError)
  }, [activeChatId, handleError, markRead, realtime?.messages[activeChatId ?? '']])

  useEffect(() => () => {
    if (toastTimer.current !== null) {
      clearTimeout(toastTimer.current)
    }
  }, [])

  const openChat = useCallback((chatId: string | null) => {
    setActiveChatId(chatId)
    setInfoOpen(false)
    const url = new URL(window.location.href)
    if (chatId === null) {
      url.searchParams.delete('chat')
    } else {
      url.searchParams.set('chat', chatId)
    }
    window.history.pushState(null, '', url)
  }, [])

  const submitMessage = useCallback(async (chat: Chat, clientId: string, text: string) => {
    setBusyChatIds(current => new Set(current).add(chat.id))
    try {
      let result: Awaited<ReturnType<typeof api.sendMessage>>
      try {
        result = await api.sendMessage(chat.id, { clientId, text })
      } catch (reason) {
        if (reason instanceof RequestError) {
          throw reason
        }
        setPendingMessages(current => ({
          ...current,
          [chat.id]: (current[chat.id] ?? []).map(item =>
            item.clientId === clientId ? { ...item, error: 'Connection interrupted; retrying once…' } : item,
          ),
        }))
        await new Promise(resolve => setTimeout(resolve, 800))
        result = await api.sendMessage(chat.id, { clientId, text })
      }
      mergeMessage(result.message)
      setPendingMessages(current => ({
        ...current,
        [chat.id]: (current[chat.id] ?? []).filter(message => message.clientId !== clientId),
      }))
    } catch (reason) {
      setPendingMessages(current => ({
        ...current,
        [chat.id]: (current[chat.id] ?? []).map(item => item.clientId === clientId ? { ...item, error: errorText(reason) } : item),
      }))
      handleError(reason)
    } finally {
      setBusyChatIds(current => {
        const next = new Set(current)
        next.delete(chat.id)
        return next
      })
    }
  }, [api, handleError, mergeMessage])

  const sendMessage = useCallback(async (chat: Chat, text: string, clientId = crypto.randomUUID()) => {
    const optimistic: Message = {
      id: `local:${clientId}`,
      chatId: chat.id,
      seq: Number.MAX_SAFE_INTEGER,
      at: Date.now(),
      kind: 'user_text',
      text,
      status: chat.id === 'general' ? 'delivered' : 'queued',
      instructionId: null,
    }
    setPendingMessages(current => ({
      ...current,
      [chat.id]: [...(current[chat.id] ?? []), { clientId, message: optimistic, error: null }],
    }))
    await submitMessage(chat, clientId, text)
  }, [submitMessage])

  const retryMessage = (chat: Chat, item: PendingMessage) => {
    setPendingMessages(current => ({
      ...current,
      [chat.id]: (current[chat.id] ?? []).map(message => message.clientId === item.clientId ? { ...message, error: null } : message),
    }))
    void submitMessage(chat, item.clientId, item.message.kind === 'user_text' ? item.message.text : '')
  }

  const runChatAction = useCallback(async (action: () => Promise<{ toast?: string }>) => {
    try {
      const result = await action()
      if (result.toast) {
        notify(result.toast)
      }
    } catch (reason) {
      handleError(reason)
    }
  }, [handleError, notify])

  const toggleAway = () => {
    if (realtime === null) {
      return
    }
    void runChatAction(() => api.setAway(!realtime.away).then(result => ({ toast: `Away mode ${result.away ? 'on' : 'off'}.` })))
  }

  const togglePush = () => {
    const enabling = !push.status.subscribed
    void (push.status.subscribed ? push.disable() : push.enable())
      .then(() => notify(enabling ? 'Push notifications enabled on this device.' : 'Push notifications disabled on this device.'))
      .catch(handleError)
  }

  const handlePromptAction = async (chatId: string, body: { promptId: string; questionIndex: number; optionIndex: number }) => {
    await runChatAction(() => api.performAction(chatId, body))
  }

  const handlePromptReply = async (promptId: string, body: { questionIndex: number; text: string }) => {
    await runChatAction(() => api.replyToPrompt(promptId, body))
  }

  const handlePickerAction = async (chatId: string, body: { pickerId: string; choice: number }) => {
    await runChatAction(() => api.performAction(chatId, body))
  }

  const runInfoAction = async (action: () => Promise<{ toast: string }>) => {
    try {
      const result = await action()
      notify(result.toast)
    } catch (reason) {
      handleError(reason)
    }
  }

  const openLinkedChat = () => {
    const chatId = new URLSearchParams(window.location.search).get('chat')
    if (chatId && chats.some(chat => chat.id === chatId)) {
      setActiveChatId(chatId)
    }
  }

  useEffect(openLinkedChat, [chats])

  const initialFailure = realtime === null && status === 'error'
  if (accessDenied || (initialFailure && error instanceof RequestError && error.accessDenied)) {
    return (
      <FullPageState
        icon={<LockKeyhole className="size-5" />}
        title="Access denied"
        detail="This browser is not allowed to reach the Web Channel. Open the app through your authorized Tailscale connection."
      />
    )
  }
  if (initialFailure) {
    return (
      <FullPageState
        icon={<AlertCircle className="size-5" />}
        title="Could not connect to the Bridge"
        detail={
          !navigator.onLine
            ? 'You are offline. The app shell is available, but Chats and actions need a connection to the Bridge.'
            : error === null
              ? 'Check that the Bridge is running and try again.'
              : errorText(error)
        }
        action={<Button onClick={reload}><RefreshCw />Try again</Button>}
      />
    )
  }
  if (realtime === null) {
    return <FullPageState icon={<LoaderCircle className="size-5 animate-spin" />} title="Connecting to the Bridge…" detail="Loading your Chats and Sessions." />
  }

  return (
    <div className={`grain relative flex h-full w-full overflow-hidden density-${preferences.density} font-${preferences.font}`}>
      <ChatList
        chats={chats}
        activeId={activeChatId}
        status={status}
        onOpen={openChat}
        onNew={() => setNewSessionOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onArchiveSelected={async chatIds => {
          const result = await api.archiveChats(chatIds)
          notify(result.toast)
        }}
        onActionError={handleError}
      />

      <main
        onTouchStart={event => {
          const touch = event.touches[0]
          touchStart.current = touch && touch.clientX < 40 ? { x: touch.clientX, y: touch.clientY } : null
        }}
        onTouchEnd={event => {
          const start = touchStart.current
          const touch = event.changedTouches[0]
          if (start && touch && touch.clientX - start.x > 80 && Math.abs(touch.clientY - start.y) < 60) {
            openChat(null)
          }
          touchStart.current = null
        }}
        className={`absolute inset-0 z-20 flex min-w-0 bg-background shadow-2xl transition-transform duration-300 md:static md:z-auto md:flex-1 md:translate-x-0 md:shadow-none ${
          activeChatId === null ? 'translate-x-full md:translate-x-0' : 'translate-x-0'
        }`}
      >
        {activeChat ? (
          <>
            <section className="flex min-w-0 flex-1 flex-col">
              <ChatHeader
                chat={activeChat}
                status={status}
                onBack={() => openChat(null)}
                onInfo={() => setInfoOpen(value => !value)}
                infoOpen={infoOpen}
              />
              {status !== 'connected' && (
                <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-center text-xs text-amber-900 dark:text-amber-200" role="status">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {status === 'resyncing' ? 'Syncing missed activity…' : status === 'loading' ? 'Connecting to the Bridge…' : 'Connection lost. Reconnecting automatically…'}
                </div>
              )}
              <div className="chat-glow flex min-h-0 flex-1 flex-col">
                <MessageFeed
                  key={activeChat.id}
                  chat={activeChat}
                  messages={messages}
                  pendingMessages={pendingForChat.map(item => ({
                    message: item.message,
                    error: item.error,
                    retry: () => retryMessage(activeChat, item),
                  }))}
                  hasMore={realtime.hasMore[activeChat.id] ?? false}
                  loadingEarlier={busyChatIds.has(`history:${activeChat.id}`)}
                  onLoadEarlier={() => {
                    const before = messages[0]?.seq
                    if (before === undefined) {
                      return
                    }
                    setBusyChatIds(current => new Set(current).add(`history:${activeChat.id}`))
                    void loadMessages(activeChat.id, before).catch(handleError).finally(() => {
                      setBusyChatIds(current => {
                        const next = new Set(current)
                        next.delete(`history:${activeChat.id}`)
                        return next
                      })
                    })
                  }}
                  onPromptAction={handlePromptAction}
                  onPromptReply={handlePromptReply}
                  onPickerAction={handlePickerAction}
                />
                <ChatComposer
                  chat={activeChat}
                  sending={busyChatIds.has(activeChat.id)}
                  onSend={text => sendMessage(activeChat, text)}
                  onResume={() => runInfoAction(() => api.resumeChat(activeChat.id))}
                />
              </div>
            </section>
            {infoOpen && (
              <ChatInfo
                chat={activeChat}
                messageCount={messages.length}
                onClose={() => setInfoOpen(false)}
                onEnd={() => runInfoAction(() => api.endChat(activeChat.id))}
                onArchive={() => runInfoAction(() => api.archiveChat(activeChat.id))}
                onUnarchive={() => runInfoAction(() => api.unarchiveChat(activeChat.id))}
                onRename={title => runInfoAction(() => api.renameChat(activeChat.id, title))}
                onClear={() => runInfoAction(() => api.clearChat(activeChat.id).then(() => ({ toast: 'Chat history cleared on all devices.' })))}
                onFork={() => runInfoAction(() => api.forkChat(activeChat.id))}
                onResume={() => runInfoAction(() => api.resumeChat(activeChat.id))}
              />
            )}
          </>
        ) : (
          <div className="chat-glow hidden min-w-0 flex-1 flex-col items-center justify-center px-8 text-center md:flex">
            <div className="grid size-16 place-items-center rounded-3xl border border-border bg-card shadow-sm">
              <MessageSquareText className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="mt-5 font-display text-xl font-semibold tracking-tight">Your Sessions, at a glance.</p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Choose a Chat to review its full conversation, reply to Prompts, or send an Instruction.
            </p>
            <Button className="mt-5" variant="outline" onClick={() => setNewSessionOpen(true)}>
              Start a Session <ArrowRight />
            </Button>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-xl" role="status" aria-live="polite">
          <span className="min-w-0">{toast}</span>
          <button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss notification" onClick={() => setToast(null)}><X className="size-4" /></button>
        </div>
      )}

      <SettingsDialog
        open={settingsOpen}
        preferences={preferences}
        push={push.status}
        pushBusy={push.busy}
        away={realtime.away}
        onPreferences={setPreferences}
        onPushToggle={togglePush}
        onAwayToggle={toggleAway}
        onOpenChange={setSettingsOpen}
      />
      <NewSessionDialog
        open={newSessionOpen}
        api={api}
        onOpenChange={setNewSessionOpen}
        onStarted={notify}
      />
    </div>
  )
}

function FullPageState({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <main className="grain flex h-full items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-7 text-center shadow-sm sm:p-9">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div>
        <h1 className="mt-5 font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{detail}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </main>
  )
}
