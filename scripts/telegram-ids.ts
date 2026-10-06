// Prints the chat ids and user ids the bot has recently seen, to fill in TELEGRAM_CHAT_ID and TELEGRAM_ALLOWED_USER_ID.
// Usage: send a message in your group, stop the Bridge, then `bun run telegram:ids`.

const ANONYMOUS_ADMIN_ID = 1087968824

type Chat = { id: number; type: string; title?: string; is_forum?: boolean }
type User = { id: number; username?: string; first_name?: string; is_bot: boolean }
type Message = { chat: Chat; from?: User; text?: string }
type Update = { update_id: number; message?: Message; edited_message?: Message; callback_query?: { from: User; message?: Message } }
type ApiResponse<T> = { ok: boolean; result: T; description?: string }

const token = process.env.TELEGRAM_BOT_TOKEN
if (token === undefined || token === '') {
  console.error('TELEGRAM_BOT_TOKEN is not set. Put it in .env or export it first.')
  process.exit(1)
}

async function call<T>(method: string): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`)
  const body = (await response.json()) as ApiResponse<T>
  if (!body.ok) {
    throw new Error(`${method} failed: ${body.description ?? response.status}`)
  }
  return body.result
}

const webhook = await call<{ url: string }>('getWebhookInfo')
if (webhook.url !== '') {
  console.error(`This bot has a webhook set (${webhook.url}), so getUpdates returns nothing.`)
  console.error(`Remove it with: curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`)
  process.exit(1)
}

const updates = await call<Update[]>('getUpdates')
if (updates.length === 0) {
  console.log('No updates found. Check that:')
  console.log('  - the Bridge is stopped (it consumes updates while running)')
  console.log('  - you sent a message in the group within the last 24 hours')
  console.log('  - the bot is an admin of the group (otherwise it only sees commands and replies)')
  process.exit(0)
}

const chats = new Map<number, Chat>()
const users = new Map<number, User>()
for (const update of updates) {
  const message = update.message ?? update.edited_message ?? update.callback_query?.message
  const from = update.message?.from ?? update.edited_message?.from ?? update.callback_query?.from
  if (message !== undefined) {
    chats.set(message.chat.id, message.chat)
  }
  if (from !== undefined && !from.is_bot) {
    users.set(from.id, from)
  }
}

console.log('Chats:')
for (const chat of chats.values()) {
  const notes: string[] = []
  if (chat.type === 'supergroup' && chat.is_forum === true) {
    notes.push('supergroup with Topics ✓ use this as TELEGRAM_CHAT_ID')
  } else if (chat.type === 'supergroup') {
    notes.push('supergroup WITHOUT Topics: enable Topics in group settings')
  } else if (chat.type === 'group') {
    notes.push('basic group: enable Topics (it becomes a supergroup with a new id), then run this again')
  } else {
    notes.push(chat.type)
  }
  console.log(`  ${chat.id}  ${chat.title ?? '(no title)'}  — ${notes.join('; ')}`)
}

console.log('\nUsers:')
for (const user of users.values()) {
  const name = user.username === undefined ? (user.first_name ?? '') : `@${user.username}`
  if (user.id === ANONYMOUS_ADMIN_ID) {
    console.log(`  ${user.id}  ${name}  — anonymous admin: turn off "Remain anonymous" for yourself, send a new message, run again`)
    continue
  }
  console.log(`  ${user.id}  ${name}  — use your own as TELEGRAM_ALLOWED_USER_ID`)
}

export {}
