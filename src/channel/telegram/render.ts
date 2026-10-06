import { escapeHtml, truncate } from '../../core/text.ts'
import type { ButtonData, PromptViewItem } from '../types.ts'

export const MAX_MESSAGE = 4096
const MAX_CALLBACK_BYTES = 64

export function encodeButton(data: ButtonData): string {
  const raw = `${data.promptId}|${data.questionIndex}|${data.optionIndex}`
  if (new TextEncoder().encode(raw).length > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data exceeds ${MAX_CALLBACK_BYTES} bytes: ${raw}`)
  }
  return raw
}

export function decodeButton(raw: string): ButtonData | undefined {
  const match = /^(.+)\|(\d+)\|(\d+)$/.exec(raw)
  if (match === null) {
    return undefined
  }
  return { promptId: match[1] ?? '', questionIndex: Number(match[2]), optionIndex: Number(match[3]) }
}

export function keyboard(item: PromptViewItem): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return { inline_keyboard: item.buttons.map(button => [{ text: button.label, callback_data: encodeButton(button.data) }]) }
}

export function renderHtml(title: string | null, body: string): string {
  const head = title === null ? '' : `<b>${escapeHtml(title)}</b>\n`
  let keep = body.length
  while (keep > 0) {
    const html = head + escapeHtml(truncate(body, keep))
    if (html.length <= MAX_MESSAGE) {
      return html
    }
    keep = Math.floor(keep * 0.8)
  }
  return head.slice(0, MAX_MESSAGE)
}
