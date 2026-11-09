import { AlertCircle, ArrowRight, LoaderCircle, LockKeyhole, MessageSquareText, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, Message, PinView, UploadRecord, UploadRef } from '../channel/web/protocol.ts'
import { createApiClient, RequestError } from './api.ts'
import { Button } from './components/ui/button.tsx'
import { ChatComposer } from './components/chat-composer.tsx'
import { ChatHeader } from './components/chat-header.tsx'
import { ChatInfo } from './components/chat-info.tsx'
import { ChatList } from './components/chat-list.tsx'
import { MessageFeed, scrollToMessage } from './components/message-feed.tsx'
import { NewSessionDialog } from './components/new-session-dialog.tsx'
import { SettingsDialog } from './components/settings-dialog.tsx'
import { readPreferences, savePreferences, type Preferences } from './preferences.ts'
import { applyAppearance } from './appearance.ts'
import { deepLink, pendingPromptMessage } from './presentation.ts'
import { makeThumbnail, MAX_UPLOAD_BYTES, toBase64, toRef } from './uploads.ts'
import { usePushSubscription } from './use-push-subscription.ts'
import { useWebChannel } from './use-web-channel.ts'

type PendingMessage = {
  clientId: string
  message: Message
  error: string | null
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

/** The feed renders a loaded page on a later frame, so retry the scroll for a few frames. False when the message never appears. */
async function scrollWhenRendered(messageId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (scrollToMessage(messageId)) {
      return true
    }
    await nextFrame()
  }
  return false
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function App() {
  const api = useMemo(() => createApiClient(), [])
  const [activeChatId, setActiveChatId] = useState<string | null>(() => deepLink(window.location.search).chatId)
  // The Prompt to scroll to once its chat is open: set by a tap on a blocked row, or by a notification's link.
  const [focusPrompt, setFocusPrompt] = useState<{ chatId: string; promptId: string } | null>(() => {
    const link = deepLink(window.location.search)
    return link.chatId !== null && link.promptId !== null ? { chatId: link.chatId, promptId: link.promptId } : null
  })
  const [infoOpen, setInfoOpen] = useState(false)
  const [pinsByChat, setPinsByChat] = useState<Record<string, PinView[]>>({})
  const [pinsVersion, setPinsVersion] = useState(0)
  const [library, setLibrary] = useState<UploadRecord[]>([])
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
      setActiveChatId(deepLink(window.location.search).chatId)
      setFocusPrompt(null)
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

  const openChat = useCallback((chatId: string | null, focus?: { promptId: string }) => {
    setActiveChatId(chatId)
    setFocusPrompt(chatId !== null && focus !== undefined ? { chatId, promptId: focus.promptId } : null)
    setInfoOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('prompt')
    if (chatId === null) {
      url.searchParams.delete('chat')
    } else {
      url.searchParams.set('chat', chatId)
    }
    window.history.pushState(null, '', url)
  }, [])

  const submitMessage = useCallback(async (chat: Chat, clientId: string, text: string, attachmentIds: string[]) => {
    setBusyChatIds(current => new Set(current).add(chat.id))
    try {
      let result: Awaited<ReturnType<typeof api.sendMessage>>
      try {
        result = await api.sendMessage(chat.id, { clientId, text, attachmentIds })
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
        result = await api.sendMessage(chat.id, { clientId, text, attachmentIds })
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

  const sendMessage = useCallback(async (chat: Chat, text: string, attachments: UploadRef[], clientId = crypto.randomUUID()) => {
    const optimistic: Message = {
      id: `local:${clientId}`,
      chatId: chat.id,
      seq: Number.MAX_SAFE_INTEGER,
      at: Date.now(),
      kind: 'user_text',
      text: text.trim(),
      status: chat.id === 'general' ? 'delivered' : 'queued',
      instructionId: null,
      ...(attachments.length > 0 ? { attachments } : {}),
    }
    setPendingMessages(current => ({
      ...current,
      [chat.id]: [...(current[chat.id] ?? []), { clientId, message: optimistic, error: null }],
    }))
    await submitMessage(chat, clientId, text, attachments.map(item => item.id))
  }, [submitMessage])

  const retryMessage = useCallback((chat: Chat, item: PendingMessage) => {
    setPendingMessages(current => ({
      ...current,
      [chat.id]: (current[chat.id] ?? []).map(message => message.clientId === item.clientId ? { ...message, error: null } : message),
    }))
    void submitMessage(
      chat,
      item.clientId,
      item.message.kind === 'user_text' ? item.message.text : '',
      item.message.kind === 'user_text' ? (item.message.attachments ?? []).map(attachment => attachment.id) : [],
    )
  }, [submitMessage])

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

  const handlePromptAction = useCallback(async (chatId: string, body: { promptId: string; questionIndex: number; optionIndex: number }) => {
    await runChatAction(() => api.performAction(chatId, body))
  }, [api, runChatAction])

  const handlePromptReply = useCallback(async (promptId: string, body: { questionIndex: number; text: string }) => {
    await runChatAction(() => api.replyToPrompt(promptId, body))
  }, [api, runChatAction])

  const handlePickerAction = useCallback(async (chatId: string, body: { pickerId: string; choice: number }) => {
    await runChatAction(() => api.performAction(chatId, body))
  }, [api, runChatAction])

  const runInfoAction = useCallback(async (action: () => Promise<{ toast: string }>) => {
    try {
      const result = await action()
      notify(result.toast)
    } catch (reason) {
      handleError(reason)
    }
  }, [handleError, notify])

  const refreshLibrary = useCallback(() => {
    api.listUploads().then(result => setLibrary(result.uploads)).catch(handleError)
  }, [api, handleError])

  const uploadFromComposer = useCallback(async (file: File): Promise<UploadRef | null> => {
    if (file.size > MAX_UPLOAD_BYTES) {
      notify('That file is larger than 10 MB.')
      return null
    }
    try {
      const { upload } = await api.uploadFile(file.name, await toBase64(file))
      let record = upload
      const thumbnail = file.type.startsWith('image/') && !upload.hasThumbnail ? await makeThumbnail(file) : null
      if (thumbnail !== null) {
        try {
          await api.uploadThumbnail(upload.id, await toBase64(thumbnail))
          record = { ...upload, hasThumbnail: true }
        } catch {
          // The original still works without a preview.
        }
      }
      setLibrary(current => [record, ...current.filter(item => item.id !== record.id)])
      return toRef(record)
    } catch (reason) {
      handleError(reason)
      return null
    }
  }, [api, handleError, notify])

  const deleteFromLibrary = useCallback(async (upload: UploadRecord) => {
    if (!window.confirm(`Delete ${upload.name} from the library? Messages that already use it will show it as removed.`)) {
      return
    }
    try {
      const result = await api.deleteUpload(upload.id)
      setLibrary(current => current.filter(item => item.id !== upload.id))
      notify(result.toast)
    } catch (reason) {
      handleError(reason)
    }
  }, [api, handleError, notify])

  const loadEarlier = useCallback(() => {
    if (activeChatId === null) {
      return
    }
    const before = messages[0]?.seq
    if (before === undefined) {
      return
    }
    setBusyChatIds(current => new Set(current).add(`history:${activeChatId}`))
    void loadMessages(activeChatId, before).catch(handleError).finally(() => {
      setBusyChatIds(current => {
        const next = new Set(current)
        next.delete(`history:${activeChatId}`)
        return next
      })
    })
  }, [activeChatId, handleError, loadMessages, messages])

  const togglePin = useCallback((message: Message) => {
    void runInfoAction(() => api.pinMessage(message.id, message.pinned !== true)).then(() => setPinsVersion(version => version + 1))
  }, [api, runInfoAction])

  const sendFromComposer = useCallback((text: string, attachments: UploadRef[]) => (activeChat === null ? Promise.resolve() : sendMessage(activeChat, text, attachments)), [activeChat, sendMessage])

  const resumeActive = useCallback(() => (activeChatId === null ? Promise.resolve() : runInfoAction(() => api.resumeChat(activeChatId))), [activeChatId, api, runInfoAction])

  const pendingItems = useMemo(() => {
    if (activeChat === null) {
      return []
    }
    const chat = activeChat
    return pendingForChat.map(item => ({
      message: item.message,
      error: item.error,
      retry: () => retryMessage(chat, item),
    }))
  }, [activeChat, pendingForChat, retryMessage])

  const openLinkedChat = () => {
    const chatId = deepLink(window.location.search).chatId
    if (chatId && chats.some(chat => chat.id === chatId)) {
      setActiveChatId(chatId)
    }
  }

  useEffect(openLinkedChat, [chats])

  /** Shows a pinned message: loads older pages until its seq is covered, then scrolls to it. */
  const jumpToPin = async (pin: PinView) => {
    const chatId = activeChatId
    if (chatId === null) {
      return
    }
    let before = messages[0]?.seq
    let hasMore = realtime?.hasMore[chatId] ?? false
    if (!scrollToMessage(pin.id) && before !== undefined && pin.seq < before && hasMore) {
      setBusyChatIds(current => new Set(current).add(`history:${chatId}`))
      try {
        while (before !== undefined && pin.seq < before && hasMore) {
          const page = await loadMessages(chatId, before)
          hasMore = page.hasMore
          before = page.messages[0]?.seq ?? before
        }
      } finally {
        setBusyChatIds(current => {
          const next = new Set(current)
          next.delete(`history:${chatId}`)
          return next
        })
      }
    }
    if (await scrollWhenRendered(pin.id)) {
      return
    }
    notify('That message could not be found in this chat.')
  }

  /** Scrolls to the Prompt a session waits on, loading older pages if it is above the loaded ones. Quiet if it was answered meanwhile. */
  const revealPrompt = async (chatId: string, promptId: string) => {
    let found = pendingPromptMessage(messages, promptId)
    let before = messages[0]?.seq
    let hasMore = realtime?.hasMore[chatId] ?? false
    while (found === undefined && before !== undefined && hasMore) {
      const page = await loadMessages(chatId, before)
      found = pendingPromptMessage(page.messages, promptId)
      hasMore = page.hasMore
      if (page.messages.length === 0) {
        break
      }
      before = page.messages[0]?.seq ?? before
    }
    if (found !== undefined) {
      await scrollWhenRendered(found.id)
    }
  }

  // Once the chat's messages are loaded, scroll to the Prompt that was asked for, then drop it so a reload does not scroll again.
  useEffect(() => {
    if (focusPrompt === null || activeChatId !== focusPrompt.chatId || realtime === null || !realtime.loadedChats.has(focusPrompt.chatId)) {
      return
    }
    const target = focusPrompt
    setFocusPrompt(null)
    const url = new URL(window.location.href)
    if (url.searchParams.has('prompt')) {
      url.searchParams.delete('prompt')
      window.history.replaceState(null, '', url)
    }
    void revealPrompt(target.chatId, target.promptId).catch(handleError)
  }, [focusPrompt, activeChatId, realtime?.loadedChats])

  // The chat's pins load when the chat is opened, and again after a pin change or a manual refresh. Opening the details does not fetch.
  useEffect(() => {
    if (activeChatId === null) {
      return
    }
    api.listPins(activeChatId).then(result => {
      setPinsByChat(current => ({ ...current, [activeChatId]: result.pins }))
    }).catch(handleError)
  }, [activeChatId, pinsVersion, api, handleError])

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
                usage={realtime.usage.chats[activeChat.id]}
              />
              {status !== 'connected' && (
                <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-center text-xs text-amber-900 dark:text-amber-200" role="status">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {status === 'resyncing' ? 'Syncing missed activity…' : status === 'loading' ? 'Connecting to the Bridge…' : 'Connection lost. Reconnecting automatically…'}
                </div>
              )}
              <div className="chat-glow flex min-h-0 flex-1 flex-col">
                <MessageFeed
                  key={`feed:${activeChat.id}`}
                  chat={activeChat}
                  messages={messages}
                  pendingMessages={pendingItems}
                  hasMore={realtime.hasMore[activeChat.id] ?? false}
                  loadingEarlier={busyChatIds.has(`history:${activeChat.id}`)}
                  onLoadEarlier={loadEarlier}
                  onPromptAction={handlePromptAction}
                  onPromptReply={handlePromptReply}
                  onPickerAction={handlePickerAction}
                  onTogglePin={togglePin}
                />
                <ChatComposer
                  key={`composer:${activeChat.id}`}
                  drafts={api}
                  chat={activeChat}
                  usage={realtime.usage}
                  sending={busyChatIds.has(activeChat.id)}
                  enterSends={preferences.enter === 'send'}
                  library={library}
                  onRefreshLibrary={refreshLibrary}
                  onUpload={uploadFromComposer}
                  onDeleteUpload={deleteFromLibrary}
                  onSend={sendFromComposer}
                  onResume={resumeActive}
                />
              </div>
            </section>
            {infoOpen && (
              <ChatInfo
                chat={activeChat}
                messageCount={messages.length}
                usage={realtime.usage}
                onClose={() => setInfoOpen(false)}
                onEnd={() => runInfoAction(() => api.endChat(activeChat.id))}
                onArchive={() => runInfoAction(() => api.archiveChat(activeChat.id))}
                onUnarchive={() => runInfoAction(() => api.unarchiveChat(activeChat.id))}
                onRename={title => runInfoAction(() => api.renameChat(activeChat.id, title))}
                onClear={() => runInfoAction(() => api.clearChat(activeChat.id).then(() => ({ toast: 'Chat history cleared on all devices.' })))}
                onFork={() => runInfoAction(() => api.forkChat(activeChat.id))}
                onResume={() => runInfoAction(() => api.resumeChat(activeChat.id))}
                pins={pinsByChat[activeChat.id] ?? []}
                onUnpin={messageId => runInfoAction(() => api.pinMessage(messageId, false)).then(() => setPinsVersion(version => version + 1))}
                onRefreshPins={() => setPinsVersion(version => version + 1)}
                onJump={pin => {
                  setInfoOpen(false)
                  void jumpToPin(pin).catch(handleError)
                }}
              />
            )}
          </>
        ) : (
          <div className="chat-glow hidden min-w-0 flex-1 flex-col items-center justify-center px-8 text-center md:flex">
            <div className="grid size-16 place-items-center rounded-3xl bg-card shadow-sm">
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
        <div className="fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-start gap-3 rounded-2xl bg-card px-4 py-3 text-sm shadow-xl" role="status" aria-live="polite">
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
      <div className="w-full max-w-md rounded-3xl bg-card p-7 text-center shadow-sm sm:p-9">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">{icon}</div>
        <h1 className="mt-5 font-display text-xl font-semibold">{title}</h1>
        <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{detail}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </main>
  )
}
