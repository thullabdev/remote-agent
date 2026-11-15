import type { Message, MessageBody } from '../channel/web/protocol.ts'
import type { TranscriptItem } from '../channel/web/transcript/parse.ts'

type ToolRun = Extract<Message, { kind: 'tool_run' }>

/**
 * A sub-agent's activity as the chat's own messages, so the details panel draws it with the same rows as the chat.
 * A tool_result joins the tool_use it answers. Items carry no time, so every message has `at` 0; no row of these kinds shows a time.
 */
export function subagentMessages(chatId: string, items: TranscriptItem[]): Message[] {
  const messages: Message[] = []
  const runs = new Map<string, ToolRun>()
  // The object is stored as given, so a tool run keeps taking its result after it is pushed.
  const push = (body: MessageBody): Message => {
    const seq = messages.length
    const message = Object.assign(body, { id: `sub-${seq}`, chatId, seq, at: 0 }) as Message
    messages.push(message)
    return message
  }
  for (const item of items) {
    if (item.kind === 'user_text') {
      push({ kind: 'user_text', text: item.text, status: 'delivered', instructionId: null })
    } else if (item.kind === 'agent_text') {
      push({ kind: 'agent_text', markdown: item.markdown })
    } else if (item.kind === 'tool_use') {
      const run = push({ kind: 'tool_run', tool: item.tool, input: item.input, result: null, resultTruncated: false, status: 'running', durationMs: null }) as ToolRun
      runs.set(item.toolUseId, run)
    } else if (item.kind === 'tool_result') {
      const run = runs.get(item.toolUseId)
      if (run === undefined) {
        push({ kind: 'tool_run', tool: 'unknown', input: null, result: item.text, resultTruncated: false, status: item.isError ? 'error' : 'done', durationMs: null })
      } else {
        run.result = item.text
        run.status = item.isError ? 'error' : 'done'
      }
    }
  }
  return messages
}
