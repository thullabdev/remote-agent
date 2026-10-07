import { escapeHtml, truncate } from '../../core/text.ts'
import type { Button, ButtonData } from '../types.ts'

export const MAX_MESSAGE = 4096
const MAX_CALLBACK_BYTES = 64

export function encodeButton(data: ButtonData): string {
  const raw = data.kind === 'answer' ? `${data.promptId}|${data.questionIndex}|${data.optionIndex}` : `launch:${data.pickerId}:${data.choice}`
  if (new TextEncoder().encode(raw).length > MAX_CALLBACK_BYTES) {
    throw new Error(`callback_data exceeds ${MAX_CALLBACK_BYTES} bytes: ${raw}`)
  }
  return raw
}

// Answer buttons always contain '|', launch buttons never do, so the two formats cannot collide.
export function decodeButton(raw: string): ButtonData | undefined {
  const launch = /^launch:([A-Za-z0-9-]+):(\d+)$/.exec(raw)
  if (launch !== null) {
    return { kind: 'launch', pickerId: launch[1] ?? '', choice: Number(launch[2]) }
  }
  const match = /^(.+)\|(\d+)\|(\d+)$/.exec(raw)
  if (match === null) {
    return undefined
  }
  return { kind: 'answer', promptId: match[1] ?? '', questionIndex: Number(match[2]), optionIndex: Number(match[3]) }
}

export function keyboard(item: { buttons: Button[] }): { inline_keyboard: { text: string; callback_data: string }[][] } {
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
