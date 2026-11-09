import { z } from 'zod'
import type { UsageView } from '../../core/usage-types.ts'

// Wire shapes for the web channel: the ChatLog, the HTTP API and the browser UI share them (handoff §4-§5).

/** What a Session is blocked on, for the chat list. Present only while the chat is active and a Prompt waits for an Answer. */
export type PendingPrompt = {
  /** The oldest pending Prompt, so the list can open straight to it. */
  promptId: string
  kind: 'permission' | 'question'
  /** One line of plain text: "Bash: bun test" for a Permission Request, the first question for a Question. */
  summary: string
  /** When the oldest pending Prompt was raised (ms epoch), for "waiting 4m". */
  at: number
  /** How many Prompts wait, counting a multi-question Prompt once. */
  count: number
}

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
  /** The unsent draft for this chat. `at` is when it was last edited: chats with a draft are listed first, newest edit on top. */
  draft: { preview: string; at: number } | null
  pinned: boolean
  tmuxName: string | null
  /** Set while the Session waits for a human Answer. Wins over `busy`, which stays true because the turn is still open. */
  pendingPrompt: PendingPrompt | null
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
  | { kind: 'user_text'; text: string; status: 'queued' | 'delivered'; instructionId: string | null; attachments?: UploadRef[] }
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

/** An uploaded file as a message shows it: enough to display it, not where it is stored. */
export type UploadRef = { id: string; name: string; mime: string; size: number }

/** A library entry as the picker lists it. */
export type UploadRecord = { id: string; name: string; mime: string; size: number; createdAt: number; hasThumbnail: boolean }

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

export const SendMessageSchema = z
  .object({
    clientId: z.string().min(1),
    /** May be empty when files are attached. */
    text: z.string(),
    /** Library uploads to attach; at most five. The Bridge checks they exist. */
    attachmentIds: z.array(z.string().min(1)).max(5).default([]),
  })
  .refine(body => body.text.trim() !== '' || body.attachmentIds.length > 0, { message: 'must not be blank', path: ['text'] })

export const ActionSchema = z.union([
  z.object({ promptId: z.string().min(1), questionIndex: z.number().int().min(0), optionIndex: z.number().int().min(0) }),
  z.object({ pickerId: z.string().min(1), choice: z.number().int().min(0) }),
])

export const PromptReplySchema = z.object({ questionIndex: z.number().int().min(0), text: NonBlankText })

export const ReadSchema = z.object({ seq: z.number().int().min(0) })

export const AwaySchema = z.object({ away: z.boolean() })

export const PinSchema = z.object({ pinned: z.boolean() })

/** Longest draft kept for a chat; the composer is a single message, so this is generous. */
export const MAX_DRAFT_CHARS = 20_000

/** An unsent message kept per chat, so it can be finished on another device. */
export const DraftSchema = z.object({
  text: z.string().max(MAX_DRAFT_CHARS),
  attachments: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().max(255),
        mime: z.string().max(100),
        size: z.number().int().nonnegative(),
      }),
    )
    .max(5),
})

export type Draft = z.infer<typeof DraftSchema>
