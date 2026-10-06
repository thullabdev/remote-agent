import { SETTLED_LOCALLY_MESSAGE, type Answer, type AnswerSource, type QuestionItem, type Report } from '../../mod/remote-agent/hooks/protocol.ts'
import type { PromptView, PromptViewItem } from '../channel/types.ts'
import { redactSecrets, truncate } from '../core/text.ts'
import type { PromptRow, SessionRow } from './store.ts'

export const LIMITS = { question: 1_500, toolInput: 1_500, report: 1_000, note: 300, reason: 300 }

const LABEL_MAX = 60

function clean(text: string, max: number): string {
  return truncate(redactSecrets(text), max)
}

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export function sessionLabel(session: SessionRow): string {
  return `${session.project} · ${session.id.slice(0, 8)}`
}

export function threadTitle(session: SessionRow): string {
  return sessionLabel(session).slice(0, 128)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000)
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

export function permissionSummary(tool: string, input: unknown): string {
  const command = field(input, 'command')
  const filePath = field(input, 'file_path')
  const url = field(input, 'url')
  let summary: string
  if (tool === 'Bash' && command !== undefined) {
    summary = `$ ${command}`
  } else if (tool === 'Edit' && filePath !== undefined) {
    summary = `${filePath}\n--- old\n${field(input, 'old_string') ?? ''}\n+++ new\n${field(input, 'new_string') ?? ''}`
  } else if (tool === 'Write' && filePath !== undefined) {
    summary = `${filePath}\n${field(input, 'content') ?? ''}`
  } else if (url !== undefined) {
    summary = url
  } else if (filePath !== undefined) {
    summary = filePath
  } else {
    summary = JSON.stringify(input, null, 2) ?? String(input)
  }
  return clean(summary, LIMITS.toolInput)
}

function questionItem(promptId: string, question: QuestionItem, questionIndex: number): PromptViewItem {
  const options = question.options
    .map((option, index) => `${index + 1}. ${option.label}${option.description === '' ? '' : ` — ${option.description}`}`)
    .join('\n')
  const hint = question.multiSelect
    ? 'Reply to this message with option numbers, e.g. 1,3'
    : 'Tap an option, or reply to this message with your own answer.'
  return {
    text: `${clean(`❓ ${question.header}\n${question.question}\n\n${options}`, LIMITS.question)}\n\n${hint}`,
    buttons: question.multiSelect
      ? []
      : question.options.map((option, optionIndex) => ({ label: clean(option.label, LABEL_MAX), data: { promptId, questionIndex, optionIndex } })),
  }
}

export function promptView(prompt: PromptRow, session: SessionRow): PromptView {
  const title = sessionLabel(session)
  const body = prompt.body
  if (body.kind === 'question') {
    return { promptId: prompt.id, title, items: body.questions.map((question, index) => questionItem(prompt.id, question, index)) }
  }
  const who = body.agentId === undefined ? '' : ' (subagent)'
  const reason = body.reason === undefined ? '' : `\nWhy: ${clean(body.reason, LIMITS.reason)}`
  return {
    promptId: prompt.id,
    title,
    items: [
      {
        text: `🔐 Permission: ${clean(body.tool, LABEL_MAX)}${who}${reason}\n\n${permissionSummary(body.tool, body.input)}\n\nReply to this message to deny with feedback.`,
        buttons: [
          { label: '✅ Allow', data: { promptId: prompt.id, questionIndex: 0, optionIndex: 0 } },
          { label: '❌ Deny', data: { promptId: prompt.id, questionIndex: 0, optionIndex: 1 } },
        ],
      },
    ],
  }
}

export function reportText(report: Report, session: SessionRow): string {
  if (report.kind === 'session_started') {
    return `🟢 Session started in ${clean(session.cwd, LIMITS.reason)}`
  }
  if (report.kind === 'session_ended') {
    return `⚪ Session ended (${clean(report.reason, LIMITS.reason)})`
  }
  const head = `${report.isAborted ? '⛔ Turn interrupted' : '✅ Turn finished'} after ${formatDuration(report.durationMs)}`
  return report.text === '' ? head : `${head}\n\n${clean(report.text, LIMITS.report)}`
}

export function resolutionNote(answer: Answer, source: AnswerSource): string {
  if (answer.kind === 'permission') {
    if (answer.message === SETTLED_LOCALLY_MESSAGE) {
      return '☑️ Answered in the terminal'
    }
    const head = `${answer.decision === 'allow' ? '✅ Allowed' : '❌ Denied'} (${source})`
    return answer.message === undefined ? head : `${head}: ${clean(answer.message, LIMITS.note)}`
  }
  const values = Object.values(answer.answers)
  if (values.length === 0) {
    return `🚫 Dismissed (${source})`
  }
  return `✅ Answered (${source}): ${clean(values.join(' / '), LIMITS.note)}`
}
