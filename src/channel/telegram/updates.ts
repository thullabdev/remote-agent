import type { MessageRef, ThreadRef } from '../types.ts'

export function isAuthorized(sender: { chatId?: number; userId?: number }, allowed: { chatId: number; allowedUserId: number }): boolean {
  return sender.chatId === allowed.chatId && sender.userId === allowed.allowedUserId
}

export function parseCommand(text: string): { name: string; args: string } | undefined {
  const match = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text)
  if (match === null) {
    return undefined
  }
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() }
}

export function threadOf(message: { is_topic_message?: boolean; message_thread_id?: number }): ThreadRef | null {
  if (message.is_topic_message !== true || message.message_thread_id === undefined) {
    return null
  }
  return String(message.message_thread_id)
}

/** Telegram marks every message in a topic as a reply to the topic's root message, so that is not a real reply. */
export function replyTarget(message: { message_thread_id?: number; reply_to_message?: { message_id: number } }): MessageRef | null {
  const reply = message.reply_to_message
  if (reply === undefined || reply.message_id === message.message_thread_id) {
    return null
  }
  return String(reply.message_id)
}
