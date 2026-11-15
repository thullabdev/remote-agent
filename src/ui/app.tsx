import { Toast, type ToastKind, type ToastState } from './components/toast.tsx'
import { AlertCircle, ArrowRight, LoaderCircle, LockKeyhole, MessageSquareText, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, ForkView, Message, PinView, UploadRecord, UploadRef } from '../channel/web/protocol.ts'
import { createApiClient, RequestError } from './api.ts'
import { newChatToOpen } from './new-chat.ts'
import { Button } from './components/ui/button.tsx'
import { ChatComposer } from './components/chat-composer.tsx'
import { ChatHeader } from './components/chat-header.tsx'
import { ChatInfo } from './components/chat-info.tsx'
import { ChatList } from './components/chat-list.tsx'
import { Dashboard } from './components/dashboard.tsx'
import { dashboardCounts, summaryText } from './dashboard-model.ts'
import { MessageFeed, scrollToMessage } from './components/message-feed.tsx'
import { TerminalPanel, type TerminalSession } from '../../extensions/terminal/frontend/TerminalPanel.tsx'
// Import extension frontend entries so they call registerPanel. One import per extension.
import '../../extensions/terminal/frontend/index.ts'
import { NewSessionDialog } from './components/new-session-dialog.tsx'
import { ResumeDialog } from './components/resume-dialog.tsx'
import { SettingsDialog } from './components/settings-dialog.tsx'
import { readPreferences, savePreferences, type Preferences } from './preferences.ts'
import { applyAppearance } from './appearance.ts'
import { connectionNoticeText, deepLink, deepLinkTerminal, pendingPromptMessage } from './presentation.ts'
import { revealMessage, type RevealTarget } from './reveal.ts'
import { makeThumbnail, MAX_UPLOAD_BYTES, toBase64, toRef } from './uploads.ts'
import { usePushSubscription } from './use-push-subscription.ts'
import { useSessionModel } from './use-session-model.ts'
import { useWebChannel } from './use-web-channel.ts'

type PendingMessage = {
  clientId: string
  message: Message
  error: string | null
}

/** How long after a session is requested a new chat may appear and be opened for the user. */
const NEW_CHAT_WATCH_MS = 30_000

/** One short wait long enough for React to commit a page or a render, and that still resolves while the tab is hidden. */
function nextTick(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 50))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function App() {
  const api = useMemo(() => createApiClient(), [])
  const [activeChatId, setActiveChatId] = useState<string | null>(() => deepLink(window.location.search).chatId)
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(() => deepLinkTerminal(window.location.search))
  const [terminals, setTerminals] = useState<TerminalSession[]>([])
  // The Prompt to scroll to once its chat is open: set by a tap on a blocked row, or by a notification's link.
  const [focusPrompt, setFocusPrompt] = useState<{ chatId: string; promptId: string } | null>(() => {
    const link = deepLink(window.location.search)
    return link.chatId !== null && link.promptId !== null ? { chatId: link.chatId, promptId: link.promptId } : null
  })
  const [infoOpen, setInfoOpen] = useState(false)
  /** The background sub-agent whose activity the details panel shows, if any. Cleared when the panel opens for the session itself. */
  const [subagentView, setSubagentView] = useState<{ chatId: string; agentId: string; title: string } | null>(null)
  const [resumeOpen, setResumeOpen] = useState(false)
  // The chats listed when a session was requested, and until when a new one is opened for the user.
  const newChatWatch = useRef<{ known: ReadonlyMap<string, Chat['status']>; until: number } | null>(null)
  const chatsRef = useRef<Chat[]>([])
  const [pinsByChat, setPinsByChat] = useState<Record<string, PinView[]>>({})
  const [pinsVersion, setPinsVersion] = useState(0)
  const [forksByChat, setForksByChat] = useState<Record<string, ForkView[]>>({})
  const [forksVersion, setForksVersion] = useState(0)
  const [library, setLibrary] = useState<UploadRecord[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [preferences, setPreferences] = useState<Preferences>(() => readPreferences())
  const [pendingMessages, setPendingMessages] = useState<Record<string, PendingMessage[]>>({})
  const [busyChatIds, setBusyChatIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const toastId = useRef(0)
  const { realtime, status, error, reload, retry, loadMessages, mergeMessage, markRead } = useWebChannel(api, activeChatId)
  // The reveal walk below runs after awaits, so it reads the latest chats and messages rather than the ones of the render that started it.
  const activeChatIdRef = useRef(activeChatId)
  activeChatIdRef.current = activeChatId
  const realtimeRef = useRef(realtime)
  realtimeRef.current = realtime
  const push = usePushSubscription(api)

  const notify = useCallback((message: string, kind: ToastKind = 'success') => {
    toastId.current += 1
    setToast({ id: toastId.current, message, kind })
  }, [])

  const handleError = useCallback((reason: unknown) => {
    if (reason instanceof RequestError && reason.accessDenied) {
      setAccessDenied(true)
    }
    notify(errorText(reason), 'error')
  }, [notify])

  const chats = realtime?.chats ?? []
  chatsRef.current = chats
  const activeChat = chats.find(chat => chat.id === activeChatId) ?? null
  const messages = activeChatId === null ? [] : realtime?.messages[activeChatId] ?? []
  const pendingForChat = activeChatId === null ? [] : pendingMessages[activeChatId] ?? []
  // The model the Session reported on its last switch wins. The transcript is asked only for sessions that have not reported one yet.
  // General is the command chat and has no Session, so it never asks which model it runs on.
  const modelChatId = activeChat !== null && activeChat.id !== 'general' ? activeChat.id : null
  const sessionModel = useSessionModel(api, modelChatId, `${activeChat?.busy ?? ''}|${activeChat?.lastMessage?.seq ?? ''}`)

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
      notify('Could not save appearance settings on this device.', 'error')
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
      setActiveTerminalId(deepLinkTerminal(window.location.search))
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

  const openChat = useCallback((chatId: string | null, focus?: { promptId: string }) => {
    // Opening a chat by hand, or from the redirect itself, ends any wait for a new chat.
    newChatWatch.current = null
    setActiveChatId(chatId)
    // A chat and a terminal are alternative main-area views: opening either one leaves the other.
    setActiveTerminalId(null)
    setFocusPrompt(chatId !== null && focus !== undefined ? { chatId, promptId: focus.promptId } : null)
    setInfoOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('prompt')
    url.searchParams.delete('terminal')
    if (chatId === null) {
      url.searchParams.delete('chat')
    } else {
      url.searchParams.set('chat', chatId)
    }
    window.history.pushState(null, '', url)
  }, [])

  /** Opens (or reattaches to) a terminal section by session id, replacing the chat in the main area. */
  const openTerminal = useCallback((sid: string) => {
    newChatWatch.current = null
    setActiveChatId(null)
    setActiveTerminalId(sid)
    setInfoOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('chat')
    url.searchParams.delete('prompt')
    url.searchParams.set('terminal', sid)
    window.history.pushState(null, '', url)
  }, [])

  /**
   * Opens a fresh terminal with a new session id, starting in `cwd` (a chat's project folder). Without one the shell starts in the
   * home directory.
   */
  const openNewTerminal = useCallback((cwd?: string) => {
    const sid = `term-${crypto.randomUUID()}`
    setTerminals(current => [...current, { id: sid, cwd: cwd ?? '', login: '', connected: false }])
    openTerminal(sid)
  }, [openTerminal])

  /** Closes a terminal session and removes it from the list. */
  const closeTerminal = useCallback((sid: string) => {
    setTerminals(current => current.filter(t => t.id !== sid))
    if (activeTerminalId === sid) {
      setActiveTerminalId(null)
      // Replace, not push: going back must not reopen a session that was just closed.
      const url = new URL(window.location.href)
      url.searchParams.delete('terminal')
      window.history.replaceState(null, '', url)
    }
  }, [activeTerminalId])

  /**
   * Opens a chat and reveals one of its messages, loading older pages until it is there. Bookmarks, fork points and Prompts all use
   * this, since the message they name is often above the newest page. Quiet: false when the message cannot be shown.
   */
  const reveal = useCallback((target: RevealTarget): Promise<boolean> => {
    return revealMessage({
      openChat: chatId => {
        if (chatId !== activeChatIdRef.current) {
          openChat(chatId)
        }
      },
      isLoaded: chatId => realtimeRef.current?.loadedChats.has(chatId) ?? false,
      messages: chatId => realtimeRef.current?.messages[chatId] ?? [],
      hasMore: chatId => realtimeRef.current?.hasMore[chatId] ?? false,
      hiddenBefore: chatId => realtimeRef.current?.hiddenBeforeSeq[chatId] ?? 0,
      loadOlder: async (chatId, before) => {
        setBusyChatIds(current => new Set(current).add(`history:${chatId}`))
        try {
          await loadMessages(chatId, before)
        } finally {
          setBusyChatIds(current => {
            const next = new Set(current)
            next.delete(`history:${chatId}`)
            return next
          })
        }
      },
      scrollTo: scrollToMessage,
      wait: nextTick,
    }, target)
  }, [loadMessages, openChat])

  /** Reveals a message and says so when it cannot be shown, for a tap the user expects to land somewhere. */
  const revealOrNotify = useCallback(async (target: RevealTarget) => {
    if (!(await reveal(target))) {
      notify('That message could not be found.', 'error')
    }
  }, [notify, reveal])

  // Forks the chat at one reply and opens the fork, when the server has already made its chat.
  // A fork starts a Session, so a second tap while one is in flight is ignored rather than starting another.
  const forkInFlight = useRef(false)
  const forkFromMessage = useCallback(async (message: Message) => {
    if (forkInFlight.current) {
      return
    }
    forkInFlight.current = true
    try {
      const result = await api.forkChat(message.chatId, message.id)
      notify(result.toast)
      setForksVersion(version => version + 1)
      if (result.chatId !== null) {
        openChat(result.chatId)
      }
    } catch (reason) {
      handleError(reason)
    } finally {
      forkInFlight.current = false
    }
  }, [api, handleError, notify, openChat])

  // Opens a chat and, when given a message, reveals that message once its page has loaded.
  const openChatAt = useCallback((chatId: string, messageId?: string, seq?: number | null) => {
    if (messageId === undefined) {
      openChat(chatId)
      return
    }
    void revealOrNotify({ chatId, seq, find: messages => messages.find(message => message.id === messageId) }).catch(handleError)
  }, [openChat, revealOrNotify, handleError])

  // After a session is requested, the first chat that appears (not General, not one already listed) is opened for the user.
  const armNewChatWatch = useCallback(() => {
    newChatWatch.current = { known: new Map(chatsRef.current.map(chat => [chat.id, chat.status])), until: Date.now() + NEW_CHAT_WATCH_MS }
  }, [])

  useEffect(() => {
    const watch = newChatWatch.current
    if (watch === null) {
      return
    }
    const created = newChatToOpen(chats, watch.known, watch.until, Date.now())
    if (created !== undefined) {
      openChat(created.id)
    } else if (Date.now() > watch.until) {
      newChatWatch.current = null
    }
  }, [chats, openChat])

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

  /**
   * Sends an answer and tells the card whether it worked: the toast is kept, and a failure is rethrown so the card can say so
   * next to the choice that was pressed instead of leaving it looking untouched.
   */
  const sendAnswer = useCallback(async (send: () => Promise<{ toast?: string }>) => {
    try {
      const result = await send()
      if (result.toast) {
        notify(result.toast)
      }
    } catch (reason) {
      handleError(reason)
      throw reason
    }
  }, [handleError, notify])

  const handlePromptAction = useCallback(async (chatId: string, body: { promptId: string; questionIndex: number; optionIndex: number }) => {
    await sendAnswer(() => api.performAction(chatId, body))
  }, [api, sendAnswer])

  const handlePromptReply = useCallback(async (promptId: string, body: { questionIndex: number; text: string }) => {
    await sendAnswer(() => api.replyToPrompt(promptId, body))
  }, [api, sendAnswer])

  const handlePickerAction = useCallback(async (chatId: string, body: { pickerId: string; choice: number }) => {
    armNewChatWatch()
    await runChatAction(() => api.performAction(chatId, body))
  }, [api, armNewChatWatch, runChatAction])

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
      notify('That file is larger than 10 MB.', 'error')
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

  const loadActivity = useCallback(() => api.getActivity(), [api])
  const showingDashboard = activeChat?.id === 'general' && preferences.generalView === 'dashboard'
  const setGeneralView = useCallback((generalView: Preferences['generalView']) => setPreferences(current => ({ ...current, generalView })), [])

  // A command typed on the dashboard is answered in the chat, so show it.
  const sendFromComposer = useCallback((text: string, attachments: UploadRef[]) => {
    if (activeChat === null) {
      return Promise.resolve()
    }
    if (activeChat.id === 'general') {
      setGeneralView('chat')
      if (text.trim().startsWith('/new')) {
        armNewChatWatch()
      }
    }
    return sendMessage(activeChat, text, attachments)
  }, [activeChat, armNewChatWatch, sendMessage, setGeneralView])

  // Resuming asks for the model first; the dialog then calls the resume.
  const resumeActive = useCallback(() => {
    if (activeChatId !== null) {
      setResumeOpen(true)
    }
    return Promise.resolve()
  }, [activeChatId])

  // A launched session that reported ready and has not been given a task yet.
  const awaitingFirstTask = useMemo(
    () => messages.some(message => message.kind === 'session_status' && message.state === 'ready') && !messages.some(message => message.kind === 'user_text'),
    [messages],
  )

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
    // Quiet if the Prompt was answered meanwhile: there is nowhere to scroll, and the link is stale rather than broken.
    void reveal({ chatId: target.chatId, find: messages => pendingPromptMessage(messages, target.promptId) }).catch(handleError)
  }, [focusPrompt, activeChatId, realtime?.loadedChats, reveal, handleError])

  // The chat's bookmarks load when the chat is opened, after a change, and whenever the details open (another device may have changed them).
  useEffect(() => {
    if (activeChatId === null) {
      return
    }
    api.listPins(activeChatId).then(result => {
      setPinsByChat(current => ({ ...current, [activeChatId]: result.pins }))
    }).catch(handleError)
  }, [activeChatId, pinsVersion, infoOpen, api, handleError])

  // The chat's forks load when the chat is opened, after a fork is made, and whenever the details open or Refresh is pressed.
  useEffect(() => {
    if (activeChatId === null) {
      return
    }
    api.listForks(activeChatId).then(result => {
      setForksByChat(current => ({ ...current, [activeChatId]: result.forks }))
    }).catch(handleError)
  }, [activeChatId, forksVersion, infoOpen, api, handleError])

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
        title="Could not reach your computer"
        detail={
          !navigator.onLine
            ? 'You are offline. The app is available, but your sessions and actions need a connection to your computer.'
            : error === null
              ? 'Check that Remote Agent is running on your computer and try again.'
              : errorText(error)
        }
        action={<Button onClick={reload}><RefreshCw />Try again</Button>}
      />
    )
  }
  if (realtime === null) {
    return <FullPageState icon={<LoaderCircle className="size-5 animate-spin" />} title="Connecting to your computer…" detail="Loading your sessions." />
  }

  return (
    <div className={`grain relative flex h-full w-full overflow-hidden density-${preferences.density} font-${preferences.font} code-${preferences.codeWrap}`}>
      <ChatList
        chats={chats}
        activeId={activeChatId}
        status={status}
        onOpen={openChat}
        onRetry={retry}
        onNew={() => setNewSessionOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onOpenTerminal={openTerminal}
        terminals={terminals}
        onArchiveSelected={async chatIds => {
          const result = await api.archiveChats(chatIds)
          notify(result.toast)
        }}
        onPinSelected={async (chatIds, pinned) => {
          let toast = ''
          for (const chatId of chatIds) {
            toast = (await api.pinChat(chatId, pinned)).toast
          }
          notify(toast)
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
          activeChatId === null && activeTerminalId === null ? 'translate-x-full md:translate-x-0' : 'translate-x-0'
        }`}
      >
        {activeTerminalId !== null ? (
          <TerminalPanel
            terminals={terminals}
            activeTerminalId={activeTerminalId}
            onBack={() => openChat(null)}
            onNew={openNewTerminal}
            onClose={closeTerminal}
            density={preferences.density}
          />
        ) : activeChat ? (
          <>
            <section className="flex min-w-0 flex-1 flex-col">
              <ChatHeader
                key={`header:${activeChat.id}`}
                chat={activeChat}
                status={status}
                onBack={() => openChat(null)}
                onInfo={() => {
                  setSubagentView(null)
                  setInfoOpen(value => !value)
                }}
                infoOpen={infoOpen}
                usage={realtime.usage.chats[activeChat.id]}
                accounts={realtime.usage.accounts}
                onRename={title => runInfoAction(() => api.renameChat(activeChat.id, title))}
                view={preferences.generalView}
                onView={setGeneralView}
                summary={summaryText(dashboardCounts(chats))}
                needsYou={dashboardCounts(chats).needsYou}
                model={activeChat?.model ?? sessionModel}
                onOpenTerminal={() => openNewTerminal(activeChat.launchCwd ?? activeChat.cwd ?? undefined)}
              />
              {connectionNoticeText(status) !== undefined && (
                <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border/60 bg-muted px-3 py-2 text-center text-xs text-muted-foreground" role="status">
                  <span className={`size-2 shrink-0 rounded-full ${status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
                  {connectionNoticeText(status)}
                  {(status === 'reconnecting' || status === 'error') && (
                    <button type="button" onClick={retry} className="shrink-0 rounded-full px-3 py-1 font-medium text-foreground hover:bg-background/60">
                      Retry
                    </button>
                  )}
                </div>
              )}
              <div className="chat-glow flex min-h-0 flex-1 flex-col">
                {showingDashboard ? (
                  <Dashboard
                    loadActivity={loadActivity}
                    chats={chats}
                    usage={realtime.usage}
                    away={realtime.away}
                    online={status === 'connected'}
                    onOpenChat={openChat}
                    onPromptAction={handlePromptAction}
                    onToggleAway={toggleAway}
                    onNewSession={() => setNewSessionOpen(true)}
                    onStartProject={cwd => {
                      armNewChatWatch()
                      return runChatAction(() => api.startProject({ cwd }))
                    }}
                    onResume={chatId => {
                      armNewChatWatch()
                      return runChatAction(() => api.resumeChat(chatId))
                    }}
                    terminals={terminals}
                    onOpenTerminal={openTerminal}
                  />
                ) : (
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
                  onFork={message => void forkFromMessage(message)}
                  onOpenChat={openChatAt}
                  onOpenSubagent={(agentId, title) => {
                    setSubagentView({ chatId: activeChat.id, agentId, title })
                    setInfoOpen(true)
                  }}
                />
                )}
                <ChatComposer
                  key={`composer:${activeChat.id}`}
                  drafts={api}
                  chat={activeChat}
                  sending={busyChatIds.has(activeChat.id)}
                  enterSends={preferences.enter === 'send'}
                  library={library}
                  onRefreshLibrary={refreshLibrary}
                  onUpload={uploadFromComposer}
                  onDeleteUpload={deleteFromLibrary}
                  onSend={sendFromComposer}
                  onResume={resumeActive}
                  firstTask={awaitingFirstTask}
                />
              </div>
            </section>
            {infoOpen && activeChat.id !== 'general' && (
              <ChatInfo
                chat={activeChat}
                model={activeChat?.model ?? sessionModel}
                api={api}
                subagent={subagentView?.chatId === activeChat.id ? subagentView : null}
                onCloseSubagent={() => setSubagentView(null)}
                onOpenSubagent={(agentId, title) => setSubagentView({ chatId: activeChat.id, agentId, title })}
                onClose={() => setInfoOpen(false)}
                onEnd={() => runInfoAction(() => api.endChat(activeChat.id))}
                onArchive={() => runInfoAction(() => api.archiveChat(activeChat.id))}
                onUnarchive={() => runInfoAction(() => api.unarchiveChat(activeChat.id))}
                onRename={title => runInfoAction(() => api.renameChat(activeChat.id, title))}
                onPin={pinned => runInfoAction(() => api.pinChat(activeChat.id, pinned))}
                onNotify={message => notify(message, 'error')}
                onClear={() => runInfoAction(() => api.clearChat(activeChat.id).then(() => ({ toast: 'Chat history hidden on all devices.' })))}
                onFork={() => runInfoAction(() => api.forkChat(activeChat.id)).then(() => setForksVersion(version => version + 1))}
                onResume={() => {
                  setResumeOpen(true)
                  return Promise.resolve()
                }}
                pins={pinsByChat[activeChat.id] ?? []}
                forks={forksByChat[activeChat.id] ?? []}
                onRefreshForks={() => setForksVersion(version => version + 1)}
                onShowFork={fork => {
                  setInfoOpen(false)
                  void revealOrNotify({
                    chatId: activeChat.id,
                    seq: fork.pointSeq,
                    find: messages => messages.find(message => message.id === fork.pointMessageId),
                  }).catch(handleError)
                }}
                onOpenFork={chatId => openChat(chatId)}
                onUnpin={messageId => runInfoAction(() => api.pinMessage(messageId, false)).then(() => setPinsVersion(version => version + 1))}
                onJump={pin => {
                  setInfoOpen(false)
                  void revealOrNotify({ chatId: activeChat.id, seq: pin.seq, find: messages => messages.find(message => message.id === pin.id) }).catch(handleError)
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

      {activeChat !== null && (
        <ResumeDialog
          open={resumeOpen}
          api={api}
          chatId={activeChat.id}
          onOpenChange={setResumeOpen}
          onResume={model => void runInfoAction(() => api.resumeChat(activeChat.id, model))}
        />
      )}
      {toast && <Toast key={toast.id} toast={toast} onDismiss={() => setToast(null)} />}

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
        onStarting={armNewChatWatch}
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
