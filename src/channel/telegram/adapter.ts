import { autoRetry } from '@grammyjs/auto-retry'
import { Bot } from 'grammy'
import type { Log } from '../../bridge/prompts.ts'
import type { Channel, ChannelHandlers, MessageRef, PromptView, ThreadRef } from '../types.ts'
import { decodeButton, keyboard, renderHtml } from './render.ts'
import { isAuthorized, parseCommand, replyTarget, threadOf } from './updates.ts'

export type TelegramConfig = { botToken: string; chatId: number; allowedUserId: number }

export class TelegramChannel implements Channel {
  private readonly bot: Bot

  constructor(
    private readonly config: TelegramConfig,
    private readonly log: Log,
  ) {
    this.bot = new Bot(config.botToken)
    this.bot.api.config.use(autoRetry())
  }

  async start(handlers: ChannelHandlers): Promise<void> {
    this.bot.use(async (ctx, next) => {
      if (!isAuthorized({ chatId: ctx.chat?.id, userId: ctx.from?.id }, this.config)) {
        this.log(`ignored update from chat=${ctx.chat?.id} user=${ctx.from?.id}`)
        return
      }
      await next()
    })

    this.bot.on('callback_query:data', async ctx => {
      const press = decodeButton(ctx.callbackQuery.data)
      if (press === undefined) {
        await ctx.answerCallbackQuery({ text: 'Unknown button.' })
        return
      }
      await ctx.answerCallbackQuery({ text: await handlers.onButton(press) })
    })

    this.bot.on('message:text', async ctx => {
      const message = ctx.message
      const thread = threadOf(message)
      const command = parseCommand(message.text)
      const reply = command === undefined
        ? await handlers.onText({ thread, replyTo: replyTarget(message), text: message.text })
        : await handlers.onCommand({ name: command.name, thread })
      if (reply === null) {
        return
      }
      await this.bot.api.sendMessage(this.config.chatId, renderHtml(null, reply), {
        parse_mode: 'HTML',
        message_thread_id: thread === null ? undefined : Number(thread),
        reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
      })
    })

    this.bot.catch(error => {
      this.log('telegram handler failed', error.error)
    })

    await this.bot.api.setMyCommands([
      { command: 'away', description: 'Send prompts and reports' },
      { command: 'back', description: 'Send prompts only' },
      { command: 'status', description: 'Show sessions and pending prompts' },
    ])
    void this.bot.start({ allowed_updates: ['message', 'callback_query'] })
  }

  async stop(): Promise<void> {
    await this.bot.stop()
  }

  async createThread(title: string): Promise<ThreadRef> {
    const topic = await this.bot.api.createForumTopic(this.config.chatId, title.slice(0, 128))
    return String(topic.message_thread_id)
  }

  async closeThread(thread: ThreadRef): Promise<void> {
    await this.bot.api.closeForumTopic(this.config.chatId, Number(thread)).catch(error => {
      this.log(`closing topic ${thread} failed`, error)
    })
  }

  async sendText(thread: ThreadRef | null, text: string, replyTo: MessageRef | null): Promise<MessageRef> {
    const message = await this.bot.api.sendMessage(this.config.chatId, renderHtml(null, text), {
      parse_mode: 'HTML',
      message_thread_id: thread === null ? undefined : Number(thread),
      reply_parameters: replyTo === null ? undefined : { message_id: Number(replyTo), allow_sending_without_reply: true },
    })
    return String(message.message_id)
  }

  async sendPrompt(thread: ThreadRef, view: PromptView): Promise<MessageRef[]> {
    const refs: MessageRef[] = []
    for (const item of view.items) {
      const message = await this.bot.api.sendMessage(this.config.chatId, renderHtml(view.title, item.text), {
        parse_mode: 'HTML',
        message_thread_id: Number(thread),
        reply_markup: item.buttons.length > 0 ? keyboard(item) : { force_reply: true, input_field_placeholder: 'e.g. 1,3' },
      })
      refs.push(String(message.message_id))
    }
    return refs
  }

  async markResolved(thread: ThreadRef, messages: MessageRef[], note: string): Promise<void> {
    for (const ref of messages) {
      await this.bot.api
        .editMessageReplyMarkup(this.config.chatId, Number(ref), { reply_markup: { inline_keyboard: [] } })
        .catch(error => {
          this.log(`removing buttons from ${ref} failed`, error)
        })
    }
    await this.sendText(thread, note, messages[0] ?? null)
  }
}
