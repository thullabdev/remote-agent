import { z } from 'zod'

// Wire shapes for the web channel: the ChatLog, the HTTP API and the browser UI share them (handoff §4-§5).

export type Chat = {
  id: string
  title: string
  project: string | null
  cwd: string | null
  status: 'active' | 'ended'
  spawned: boolean
  busy: boolean
  unread: number
  lastMessage: { seq: number; at: number; preview: string } | null
  pinned: boolean
  tmuxName: string | null
}

export type PromptBodyView =
  | {
      kind: 'question'
      questions: {
        question: string
        header: string
        multiSelect: boolean
        options: { label: string; description: string }[]
        answered: string | null
      }[]
    }
  | { kind: 'permission'; tool: string; summary: string; reason: string | null; agentId: string | null }

export type MessageBody =
  | { kind: 'user_text'; text: string; status: 'queued' | 'delivered'; instructionId: string | null }
  | { kind: 'agent_text'; markdown: string }
  | {
      kind: 'tool_run'
      tool: string
      input: unknown
      result: string | null
      resultTruncated: boolean
      status: 'running' | 'done' | 'error'
      durationMs: number | null
    }
  | {
      kind: 'prompt'
      promptId: string
      title: string
      body: PromptBodyView
      status: 'pending' | 'answered'
      resolution: { note: string; source: 'local' | 'remote' } | null
    }
  | { kind: 'system'; text: string }
  | { kind: 'command_reply'; text: string }
  | { kind: 'picker'; pickerId: string; text: string; buttons: { label: string; choice: number }[] }

export type MessageKind = MessageBody['kind']

export type Message = { id: string; chatId: string; seq: number; at: number } & MessageBody

export type PushSubscriptionRecord = { endpoint: string; keys: { p256dh: string; auth: string } }

export type ServerEvent =
  | { type: 'hello'; seq: number }
  | { type: 'message.created'; seq: number; message: Message }
  | { type: 'message.updated'; seq: number; message: Message }
  | { type: 'chat.updated'; seq: number; chat: Chat }
  | { type: 'away.updated'; seq: number; away: boolean }
  | { type: 'resync' }

export const ClientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('presence'),
    visible: z.boolean(),
    focused: z.boolean(),
    chatId: z.string().nullable(),
  }),
  z.object({ type: z.literal('ping') }),
])

export type ClientEvent = z.infer<typeof ClientEventSchema>
