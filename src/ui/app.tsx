import { Toast, type ToastKind, type ToastState } from './components/toast.tsx'
import { AlertCircle, LoaderCircle, LockKeyhole, MessageSquareText, RefreshCw, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, ForkView, Message, PinView, UploadRecord, UploadRef } from '../channel/web/protocol.ts'
import { createApiClient, RequestError } from './api.ts'
import { newChatToOpen } from './new-chat.ts'
import { Button } from './components/ui/button.tsx'
import { ChatComposer } from './components/chat-composer.tsx'
import { setChatOpener } from './composer-bus.ts'
import { ChatHeader } from './components/chat-header.tsx'
import { ChatInfo } from './components/chat-info.tsx'
import { SidePanel } from './components/side-panel/SidePanel.tsx'
import { SidePanelFrame } from './components/side-panel/SidePanelFrame.tsx'
import { SideColumn } from './components/side-panel/SideColumn.tsx'
import type { ActivityTab } from './components/side-panel/ActivityBar.tsx'
import { CHATS_TAB, readSideTab, saveSideTab, SETTINGS_TAB } from './components/side-panel/side-tab.ts'
import { Dashboard } from './components/dashboard.tsx'
import { dashboardCounts, summaryText } from './dashboard-model.ts'
import { MessageFeed, scrollToMessage } from './components/message-feed.tsx'
import { ExtensionRegistry, getPanels } from './components/extension-registry.tsx'
import { ChatView } from './shell/ChatView.tsx'
import { EmptyChatState } from './shell/EmptyChatState.tsx'
import { FullPageState } from './shell/FullPageState.tsx'
import { MainArea } from './shell/MainArea.tsx'
import { chatActionsFor, dashboardCards, sideTabRender, sideTabs, type ActivePanel } from './extension-slots.ts'
import './extensions.ts'
import { NewSessionDialog } from './components/new-session-dialog.tsx'
import { ResumeDialog } from './components/resume-dialog.tsx'
import { SettingsSidePanel } from './components/settings/SettingsSidePanel.tsx'
import { SettingsView } from './components/settings/SettingsView.tsx'
import type { SettingGroupId, SettingId } from './settings/settings-registry.ts'
import { readPreferences, savePreferences, type Preferences } from './preferences.ts'
import { applyAppearance } from './appearance.ts'
import { connectionNoticeText, deepLink, deepLinkPanel, pendingPromptMessage } from './presentation.ts'
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

/** Removes a panel's URL parameters: its id, and whatever parameters it set. */
function clearPanelParams(url: URL, panel: ActivePanel | null): void {
  url.searchParams.delete('panel')
  for (const key of Object.keys(panel?.params ?? {})) {
    url.searchParams.delete(key)
  }
}

/** The panel a link names, if an extension registered one. A link to a panel nobody registered opens nothing. */
function registeredPanelOf(search: string): ActivePanel | null {
  const panel = deepLinkPanel(search)
  return panel !== null && getPanels().some(item => item.id === panel.id) ? panel : null
}

/** The side tab a link names, if one is registered (`?panel=terminal` opens the Terminals tab); otherwise the remembered one. */
function sideTabOf(search: string): string {
  const named = new URLSearchParams(search).get('panel')
  const ids = sideTabs().map(tab => tab.id)
  return named !== null && ids.includes(named) ? named : readSideTab(ids)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function App() {
  const api = useMemo(() => createApiClient(), [])
  const [activeChatId, setActiveChatId] = useState<string | null>(() => deepLink(window.location.search).chatId)
  // The extension panel shown in the main area instead of a chat. The host does not read its parameters.
  const [activePanel, setActivePanel] = useState<ActivePanel | null>(() => registeredPanelOf(window.location.search))
  const activePanelRef = useRef(activePanel)
  activePanelRef.current = activePanel
  // The tab the side column shows: Chats, or an extension's side tab. Remembered on this device.
  const [sideTab, setSideTab] = useState(() => sideTabOf(window.location.search))
  // The chat the person last had open. On a phone the side column covers the chat, so the side tab still needs its folder.
  const [recentChatId, setRecentChatId] = useState<string | null>(null)
  const selectSideTab = useCallback((id: string) => {
    setSideTab(id)
    try {
      saveSideTab(id)
    } catch {
      // The tab still opens; it is just not remembered on the next visit.
    }
  }, [])
  // Settings is host-owned and always last, after the extension tabs.
  const sideTabList: ActivityTab[] = [
    { id: CHATS_TAB, title: 'Chats', icon: MessageSquareText },
    ...sideTabs(),
    { id: SETTINGS_TAB, title: 'Settings', icon: Settings },
  ]
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
  // The settings group shown in the main area, and the setting a search result picked inside it. Only one main-area view shows.
  const [settingsView, setSettingsView] = useState<{ group: SettingGroupId; focus?: SettingId } | null>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [preferences, setPreferences] = useState<Preferences>(() => readPreferences())
  const [pendingMessages, setPendingMessages] = useState<Record<string, PendingMessage[]>>({})
  const [busyChatIds, setBusyChatIds] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<ToastState | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)
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
  const sideChat = chats.find(chat => chat.id === (activeChatId ?? recentChatId)) ?? null
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
    if (activeChatId !== null) {
      setRecentChatId(activeChatId)
    }
  }, [activeChatId])

  useEffect(() => {
    if (activeChatId !== null && realtime !== null && !chats.some(chat => chat.id === activeChatId)) {
      setActiveChatId(null)
    }
  }, [activeChatId, chats, realtime])

  useEffect(() => {
    const handlePopState = () => {
      setActiveChatId(deepLink(window.location.search).chatId)
      setActivePanel(registeredPanelOf(window.location.search))
      // The URL names a chat or a panel, so the settings view must not stay on top of it.
      setSettingsView(null)
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
    // A chat and a panel are alternative main-area views: opening either one leaves the other.
    setActivePanel(null)
    setSettingsView(null)
    setFocusPrompt(chatId !== null && focus !== undefined ? { chatId, promptId: focus.promptId } : null)
    setInfoOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('prompt')
    clearPanelParams(url, activePanelRef.current)
    if (chatId === null) {
      url.searchParams.delete('chat')
    } else {
      url.searchParams.set('chat', chatId)
    }
    window.history.pushState(null, '', url)
  }, [])

  // Extensions bring this chat into view when they attach to it from another main-area view (such as a diff).
  useEffect(() => setChatOpener(chatId => openChat(chatId)), [openChat])

  /**
   * Shows a side tab. On a phone the side column covers the chat, so showing it means leaving the chat; the chat stays the
   * side tab's context. On desktop the chat stays where it is, beside the tab.
   */
  const openSideTab = useCallback((id: string) => {
    selectSideTab(id)
    if (window.matchMedia('(max-width: 767px)').matches) {
      openChat(null)
    }
  }, [openChat, selectSideTab])

  /** Shows an extension panel in the main area, replacing the chat. The panel's parameters go into the URL. */
  const openPanel = useCallback((id: string, params: Record<string, string> = {}) => {
    newChatWatch.current = null
    setActiveChatId(null)
    setSettingsView(null)
    setActivePanel({ id, params })
    setInfoOpen(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('chat')
    url.searchParams.delete('prompt')
    clearPanelParams(url, activePanelRef.current)
    url.searchParams.set('panel', id)
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
    window.history.pushState(null, '', url)
  }, [])

  /**
   * Leaves the panel for the chat list, or for `chatId` when given. Replaces the history entry when asked, so going back does not
   * reopen what was closed. Opening a chat adds its own history entry.
   */
  const closePanel = useCallback(
    (options?: { replace?: boolean; chatId?: string }) => {
      if (options?.chatId !== undefined) {
        openChat(options.chatId)
        return
      }
      setActivePanel(null)
      const url = new URL(window.location.href)
      clearPanelParams(url, activePanelRef.current)
      if (options?.replace === true) {
        window.history.replaceState(null, '', url)
      } else {
        window.history.pushState(null, '', url)
      }
    },
    [openChat],
  )

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
      <SideColumn shown={activeChatId === null} tabs={sideTabList} selected={sideTab} onSelect={selectSideTab}>
        {sideTab === CHATS_TAB ? (
          <SidePanel
            chats={chats}
            activeId={activeChatId}
            status={status}
            onOpen={openChat}
            onRetry={retry}
            onNew={() => setNewSessionOpen(true)}
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
        ) : sideTab === SETTINGS_TAB ? (
          <SettingsSidePanel onOpen={(group, focus) => setSettingsView({ group, focus })} />
        ) : (
          <SidePanelFrame label={sideTabList.find(tab => tab.id === sideTab)?.title ?? 'Side panel'}>
            {sideTabRender(sideTab, { activeChat: sideChat, openPanel, notify, density: preferences.density })}
          </SidePanelFrame>
        )}
      </SideColumn>

      <MainArea shown={activeChatId !== null || activePanel !== null || settingsView !== null} onSwipeBack={() => openChat(null)}>
        {settingsView !== null ? (
          <SettingsView
            group={settingsView.group}
            focus={settingsView.focus}
            preferences={preferences}
            onPreferences={setPreferences}
            away={realtime.away}
            onAwayToggle={toggleAway}
            push={push.status}
            pushBusy={push.busy}
            onPushToggle={togglePush}
            onBack={() => setSettingsView(null)}
          />
        ) : activePanel !== null ? (
          <ExtensionRegistry
            panel={activePanel}
            context={{ params: activePanel.params, openPanel, closePanel, notify, density: preferences.density }}
          />
        ) : activeChat ? (
          <>
            <ChatView
              status={status}
              onRetry={retry}
              header={
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
                  chatActions={chatActionsFor({ chat: activeChat, openPanel, openSideTab, notify })}
                />
              }
              composer={
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
              }
            >
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
                      cards={dashboardCards({ online: status === 'connected', openPanel, openSideTab, notify })}
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
            </ChatView>
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
                openPanel={openPanel}
                density={preferences.density}
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
          <EmptyChatState onStart={() => setNewSessionOpen(true)} />
        )}
      </MainArea>

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
