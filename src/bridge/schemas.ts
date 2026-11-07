import { z } from 'zod'

const SessionInfoSchema = z.object({ sessionId: z.string().min(1), cwd: z.string().min(1) })

const QuestionItemSchema = z.object({
  question: z.string().min(1),
  header: z.string(),
  multiSelect: z.boolean(),
  options: z.array(z.object({ label: z.string().min(1), description: z.string() })).min(1),
})

const PromptBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), questions: z.array(QuestionItemSchema).min(1).max(4) }),
  z.object({ kind: z.literal('permission'), tool: z.string().min(1), input: z.unknown(), reason: z.string().optional(), agentId: z.string().optional() }),
])

// 56 chars keeps Telegram callback_data (`<id>|q|o`) under its 64-byte limit.
export const CreatePromptSchema = z.object({ promptId: z.string().min(1).max(56), session: SessionInfoSchema, body: PromptBodySchema })

const AnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), answers: z.record(z.string()) }),
  z.object({ kind: z.literal('permission'), decision: z.enum(['allow', 'deny']), message: z.string().optional() }),
])

export const LocalAnswerSchema = z.object({ answer: AnswerSchema })

export const ReportRequestSchema = z.object({
  session: SessionInfoSchema,
  report: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('session_started') }),
    z.object({ kind: z.literal('session_ended'), reason: z.string() }),
    z.object({ kind: z.literal('turn_complete'), text: z.string(), durationMs: z.number().nonnegative(), isAborted: z.boolean() }),
  ]),
})

export const UsageRequestSchema = z.object({
  session: SessionInfoSchema,
  source: z.string().min(1).default('claude-code'),
  usage: z.object({
    context: z.object({ window: z.number().nonnegative(), tokens: z.number().optional(), percent: z.number().optional() }),
    rateLimits: z.array(z.object({ kind: z.string(), percentUsed: z.number(), resetsAt: z.string().optional() })),
    cost: z.object({ usd: z.number() }).optional(),
  }),
})

export const TitleRequestSchema = z.object({ session: SessionInfoSchema, title: z.string() })

export const SettleRequestSchema = z.object({
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tool'), tool: z.string().min(1), input: z.unknown(), denied: z.boolean() }),
    z.object({ kind: z.literal('all') }),
  ]),
})
