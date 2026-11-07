import type { Chat, Message, PushSubscriptionRecord, UsageView } from '../channel/web/protocol.ts'

export type WebState = { seq: number; away: boolean; chats: Chat[]; usage: UsageView }
export type MessagePage = { messages: Message[]; hasMore: boolean }
export type Project = { label: string; cwd: string }

export class RequestError extends Error {
  readonly accessDenied: boolean

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RequestError'
    this.accessDenied = (status === 401 || status === 403) && message !== 'content type must be application/json'
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export function createApiClient(fetcher: Fetcher = fetch): {
  getState(): Promise<WebState>
  getMessages(chatId: string, before?: number): Promise<MessagePage>
  sendMessage(chatId: string, body: { clientId: string; text: string }): Promise<{ message: Message }>
  performAction(chatId: string, body: { promptId: string; questionIndex: number; optionIndex: number } | { pickerId: string; choice: number }): Promise<{ toast: string }>
  replyToPrompt(promptId: string, body: { questionIndex: number; text: string }): Promise<{ toast: string }>
  markRead(chatId: string, seq: number): Promise<{ ok: true }>
  setAway(away: boolean): Promise<{ away: boolean }>
  endChat(chatId: string): Promise<{ toast: string }>
  archiveChat(chatId: string): Promise<{ toast: string }>
  archiveChats(chatIds: string[]): Promise<{ toast: string }>
  unarchiveChat(chatId: string): Promise<{ toast: string }>
  renameChat(chatId: string, title: string): Promise<{ toast: string }>
  clearChat(chatId: string): Promise<{ ok: true }>
  forkChat(chatId: string): Promise<{ toast: string }>
  resumeChat(chatId: string): Promise<{ toast: string }>
  getProjects(): Promise<{ projects: Project[] }>
  startProject(body: { cwd: string; model?: string }): Promise<{ toast: string }>
  getPushKey(): Promise<{ key: string }>
  subscribePush(subscription: PushSubscriptionRecord): Promise<{ ok: true }>
  unsubscribePush(endpoint: string): Promise<{ ok: true }>
} {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(path, init)
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const message =
        payload !== null && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : `Request failed (${response.status}).`
      throw new RequestError(response.status, message)
    }
    return payload as T
  }

  function get<T>(path: string): Promise<T> {
    return request<T>(path)
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  return {
    getState: () => get('/api/state'),
    getMessages: (chatId, before) => {
      const query = before === undefined ? '' : `?before=${before}`
      return get(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`)
    },
    sendMessage: (chatId, body) => post(`/api/chats/${encodeURIComponent(chatId)}/messages`, body),
    performAction: (chatId, body) => post(`/api/chats/${encodeURIComponent(chatId)}/actions`, body),
    replyToPrompt: (promptId, body) => post(`/api/prompts/${encodeURIComponent(promptId)}/reply`, body),
    markRead: (chatId, seq) => post(`/api/chats/${encodeURIComponent(chatId)}/read`, { seq }),
    setAway: away =>
      request('/api/away', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ away }),
      }),
    endChat: chatId => post(`/api/chats/${encodeURIComponent(chatId)}/end`),
    archiveChat: chatId => post(`/api/chats/${encodeURIComponent(chatId)}/archive`),
    archiveChats: async chatIds => {
      try {
        return await post('/api/chats/archive', { chatIds })
      } catch (error) {
        if (!(error instanceof RequestError) || error.status !== 404 || error.message !== 'Not found.') {
          throw error
        }
        for (const chatId of chatIds) {
          await post(`/api/chats/${encodeURIComponent(chatId)}/archive`)
        }
        return { toast: `Archived ${chatIds.length} ${chatIds.length === 1 ? 'Session' : 'Sessions'}.` }
      }
    },
    unarchiveChat: chatId => post(`/api/chats/${encodeURIComponent(chatId)}/unarchive`),
    renameChat: (chatId, title) => post(`/api/chats/${encodeURIComponent(chatId)}/rename`, { title }),
    clearChat: chatId => post(`/api/chats/${encodeURIComponent(chatId)}/clear`),
    forkChat: chatId => post(`/api/chats/${encodeURIComponent(chatId)}/fork`),
    resumeChat: chatId => post(`/api/chats/${encodeURIComponent(chatId)}/resume`),
    getProjects: () => get('/api/projects'),
    startProject: body => post('/api/projects/start', body),
    getPushKey: () => get('/api/push/key'),
    subscribePush: subscription => post('/api/push/subscriptions', { subscription }),
    unsubscribePush: endpoint =>
      request('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }),
  }
}
