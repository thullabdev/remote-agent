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

/** What a working Session is doing right now: its running tool call. */
export type ChatActivity = {
  tool: string
  /** The command, file or URL the tool acts on; empty when there is none. */
  summary: string
  /** When the tool call started (ms epoch), for "12s". */
  at: number
}

/** One day of the dashboard's Today card. `date` is YYYY-MM-DD in the viewer's zone. */
export type ActivityDay = { date: string; sessionsStarted: number; turnsCompleted: number; workedMs: number }

/** A line of the dashboard's recent activity. */
/**
 * A line of recent activity. A finished burst covers `turns` turns from `firstAt` to `at`; `preview` is the newest reply of that
 * burst, cut to one line, or null when none was found. Started and ended lines have no turns and no preview.
 */
export type ActivityEvent = {
  id: number
  at: number
  firstAt: number
  chatId: string
  kind: 'started' | 'finished' | 'ended'
  name: string
  turns: number
  preview: string | null
}

export type ActivityView = {
  days: ActivityDay[]
  recent: ActivityEvent[]
  /** When recording began (ms epoch), or null before anything was recorded; days before it are empty, not quiet. */
  since: number | null
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
  /** Set on a chat made by forking another: the origin's title and the message it was forked from. Null for other chats; absent in tests that build a bare chat. */
  /**
   * `fromMessageId` is the message in the origin the fork was made from. `anchorMessageId` and `anchorSeq` are this chat's own copy of
   * that reply, where the fork's banner sits; the banner goes right after it, or above the oldest loaded message when the copy is in an
   * older page. Both are null until the copied history has been recorded.
   */
  forkedFrom?: { chatId: string; title: string; fromMessageId: string; anchorMessageId?: string | null; anchorSeq?: number | null } | null
  pinned: boolean
  tmuxName: string | null
  /** The full model id the Session runs on, from Claude Code's model switch. Null until it is known; absent in tests that build a bare chat. */
  model?: string | null
  /** Set while the Session waits for a human Answer. Wins over `busy`, which stays true because the turn is still open. */
  pendingPrompt: PendingPrompt | null
  /** The running tool call while the Session works. Null when idle, ended, waiting on a Prompt, or between tool calls. */
  activity: ChatActivity | null
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
      /** A sub-agent launched in the background: its id, which fetches its report and activity. Absent for other tools. */
      agentId?: string
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
  /**
   * A row linking a fork and its origin. `forked_to` sits at the end of the origin's feed. `otherChatId` is the other chat: not `chatId`,
   * which a Message already uses for the chat it is in, and which would overwrite this value when the body is spread into a Message.
   * `pointMessageId` is the message in this chat the fork was made from.
   */
  | { kind: 'fork_link'; direction: 'forked_to' | 'forked_from'; otherChatId: string; title: string; pointMessageId: string }
  /** A Spawned Session's startup: one card that moves from starting to ready or failed. */
  | { kind: 'session_status'; state: 'starting' | 'resuming' | 'ready' | 'failed'; cwd: string; message: string | null; detail: string | null }
  | { kind: 'command_reply'; text: string }
  /** `detail` is a second line under the label; `at` is when the item was made, shown as a relative time. */
  | { kind: 'picker'; pickerId: string; text: string; buttons: { label: string; choice: number; detail?: string; at?: number }[] }

export type MessageKind = MessageBody['kind']

/**
 * An uploaded file as a message shows it. `path` is where the Session reads the file; the Bridge sets it when it sends the
 * message, so the chat can show exactly what the Session received.
 */
export type UploadRef = { id: string; name: string; mime: string; size: number; path?: string }

/** A library entry as the library lists it. `uses` counts the messages that attached it. */
export type UploadRecord = { id: string; name: string; mime: string; size: number; createdAt: number; hasThumbnail: boolean; uses?: number }

/**
 * A fork of a chat as the chat's details list shows it. `pointMessageId` is the reply in the chat the fork was made from; `pointVisible`
 * is false once that reply has been cleared from the chat, when there is nothing left to jump to.
 */
export type ForkView = {
  chatId: string
  title: string
  status: 'active' | 'ended'
  createdAt: number
  pointMessageId: string
  pointSeq: number
  pointPreview: string
  pointVisible: boolean
}

/** A pinned message as the chat details list shows it. */
export type PinView = { id: string; seq: number; at: number; kind: MessageKind; preview: string }

export type Message = {
  id: string
  chatId: string
  seq: number
  at: number
  /** Absent means not pinned; the server always sends it. */
  pinned?: boolean
  /** Set on an agent reply that came from a transcript, so a fork can cut the transcript at it. Absent on replies the bridge wrote itself. */
  forkable?: true
} & MessageBody

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
