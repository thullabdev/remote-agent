import { z } from 'zod'
import type { UsageView } from '../../core/usage-types.ts'

// Wire shapes for the web channel: the ChatLog, the HTTP API and the browser UI share them (handoff §4-§5).

export type Chat = {
  id: string
  title: string
  project: string | null
  cwd: string | null
  status: 'active' | 'ended'
  spawned: boolean
  archived: boolean
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

/** A pinned message as the chat details list shows it. */
export type PinView = { id: string; seq: number; at: number; kind: MessageKind; preview: string }

export type Message = { id: string; chatId: string; seq: number; at: number; /** Absent means not pinned; the server always sends it. */ pinned?: boolean } & MessageBody

export type PushSubscriptionRecord = { endpoint: string; keys: { p256dh: string; auth: string } }

/** Re-exported so web code keeps importing the usage shape from the protocol. */
export type { UsageView }

export type ServerEvent =
  | { type: 'hello'; seq: number }
  | { type: 'message.created'; seq: number; message: Message }
  | { type: 'message.updated'; seq: number; message: Message }
  | { type: 'chat.updated'; seq: number; chat: Chat }
  | { type: 'chat.cleared'; seq: number; chatId: string; beforeSeq: number }
  | { type: 'away.updated'; seq: number; away: boolean }
  | { type: 'resync' }
  /** Ephemeral: usage is a current value, not history, so it carries no seq and never enters the ChatLog. */
  | { type: 'usage.updated'; usage: UsageView }

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

/** The source id a client-sent message is stored under, so a retry with the same clientId finds it. */
export function clientSourceId(clientId: string): string {
  return `client:${clientId}`
}

// Request bodies of the HTTP API (handoff §3). Unknown keys are stripped; a bad body answers 400.
const NonBlankText = z.string().refine(text => text.trim() !== '', 'must not be blank')

export const SendMessageSchema = z.object({ clientId: z.string().min(1), text: NonBlankText })

export const ActionSchema = z.union([
  z.object({ promptId: z.string().min(1), questionIndex: z.number().int().min(0), optionIndex: z.number().int().min(0) }),
  z.object({ pickerId: z.string().min(1), choice: z.number().int().min(0) }),
])

export const PromptReplySchema = z.object({ questionIndex: z.number().int().min(0), text: NonBlankText })

export const ReadSchema = z.object({ seq: z.number().int().min(0) })

export const AwaySchema = z.object({ away: z.boolean() })

export const PinSchema = z.object({ pinned: z.boolean() })
