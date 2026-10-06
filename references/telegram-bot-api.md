# Telegram Bot API notes for a Claude Code remote bridge

Researched 2026-10-06. Primary source: **Telegram Bot API** <https://core.telegram.org/bots/api> (Bot API 10.3, "August 24, 2026" per its Recent changes), cited as `[api]` plus a section, and **Bots FAQ** <https://core.telegram.org/bots/faq>. Library facts come from the grammY docs <https://grammy.dev> and the npm registry. **UNVERIFIED** marks unconfirmed items.

---

## 1. Making requests

* `https://api.telegram.org/bot<token>/METHOD_NAME`. GET or POST. Parameters can be sent as a query string, urlencoded, JSON, or multipart. Responses look like `{ ok, result | description, error_code, parameters? }` ([api#making-requests](https://core.telegram.org/bots/api#making-requests)).
* The flood-control field is `ResponseParameters.retry_after`: "the number of seconds left to wait before the request can be repeated" ([api#responseparameters](https://core.telegram.org/bots/api#responseparameters)).
* You can self-host the Bot API server (telegram-bot-api) for bigger file limits ([api#using-a-local-bot-api-server](https://core.telegram.org/bots/api#using-a-local-bot-api-server)). It isn't needed here.

## 2. Receiving updates: long polling or webhook

"There are two mutually exclusive ways of receiving updates … Incoming updates are stored on the server until the bot receives them either way, but they will not be kept longer than **24 hours**." ([api#getting-updates](https://core.telegram.org/bots/api#getting-updates))

### 2.1 `getUpdates` (long polling): recommended for a local daemon
Parameters ([api#getupdates](https://core.telegram.org/bots/api#getupdates)):
* `offset`: "Identifier of the first update to be returned. **Must be greater by one than the highest among the identifiers of previously received updates.** … An update is considered **confirmed** as soon as `getUpdates` is called with an `offset` higher than its `update_id`." A negative offset reads from the end of the queue and forgets everything before.
* `limit`: 1–100 (default 100).
* `timeout`: "Timeout in seconds for long polling. Defaults to 0, i.e. usual short polling. Should be positive". Typical values are 25–50 s.
* `allowed_updates`: e.g. `["message","callback_query"]`. "If not specified, the previous setting will be used."
* Notes: it doesn't work while a webhook is set. "In order to avoid getting duplicate updates, recalculate offset after each server response."
* `update_id` "start[s] from a certain positive number and increase sequentially … If there are no new updates for at least a week, then identifier of the next update will be chosen randomly" ([api#update](https://core.telegram.org/bots/api#update)). → Persist the last processed `update_id` (e.g. in SQLite) and commit it *after* handling, for at-least-once delivery plus idempotent handlers.
* Only **one** `getUpdates` consumer per token. A second poller gets HTTP 409 Conflict. This comes from Anthropic's official Telegram channel plugin source, which kills stale pollers for exactly that reason ([claude-plugins-official/external_plugins/telegram/server.ts](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram)). The 409 isn't stated on the API page itself. → **One daemon owns the bot token.** Never run the official Telegram channel plugin with the same token alongside your daemon.

### 2.2 `setWebhook`
* Telegram POSTs each `Update` as JSON to an HTTPS URL. It retries on non-2xx and "give[s] up after a reasonable amount of attempts" ([api#setwebhook](https://core.telegram.org/bots/api#setwebhook)).
* `secret_token` (1–256 characters, `A-Za-z0-9_-`) is sent in the header **`X-Telegram-Bot-Api-Secret-Token`**. Verify it with a constant-time compare.
* Other options: `max_connections` (1–100, default 40), `allowed_updates`, `drop_pending_updates`, `ip_address`, `certificate`.
* Allowed ports: **443, 80, 88, 8443**. Use `deleteWebhook` to switch back to polling.
* For a dev laptop, webhooks need a public HTTPS endpoint (a tunnel), which adds attack surface. **Long polling needs no inbound port**, so prefer it.

## 3. Sending messages

`sendMessage` ([api#sendmessage](https://core.telegram.org/bots/api#sendmessage)):
* `chat_id`.
* `text`: "**1-4096 characters after entities parsing**".
* `parse_mode` or `entities`.
* `message_thread_id`: "for forum supergroups and **private chats of bots with forum topic mode enabled** only".
* `reply_parameters`: the message to reply to.
* `reply_markup`: inline keyboard, `ForceReply`, etc.
* `disable_notification`, `protect_content`, `link_preview_options`.
* Long Claude output must be **chunked to at most 4096** characters (after entity parsing). The official plugin does this by paragraph or length ([server.ts](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram)). Alternatives: send long transcripts as a document (`sendDocument`), or send a short summary plus a "show more" button.
* After a question is answered, edit the original prompt message to show the outcome and remove the buttons, using `editMessageText` / `editMessageReplyMarkup` ([api#editmessagetext](https://core.telegram.org/bots/api#editmessagetext)).

### 3.1 Formatting and escaping ([api#formatting-options](https://core.telegram.org/bots/api#formatting-options))
* **MarkdownV2:**
  * "In all other places characters `_ * [ ] ( ) ~ `` ` `` > # + - = | { } . !` **must be escaped** with the preceding character '\'."
  * Inside `pre`/`code`, escape `` ` `` and `\`.
  * Inside link `(...)`, escape `)` and `\`.
  * Error-prone with arbitrary model output.
* **HTML:**
  * Supported tags include `<b> <i> <u> <s> <tg-spoiler> <a href> <code> <pre> <blockquote>`.
  * "All `<`, `>` and `&` symbols that are not a part of a tag or an HTML entity must be replaced with the corresponding HTML entities". The only named entities are `&lt; &gt; &amp; &quot;`.
  * → **Recommendation:** use `parse_mode: "HTML"` and escape just `& < >` on every dynamic string. Wrap code and commands in `<pre>`/`<code>`. This is much more robust than MarkdownV2. Chunk *before* escaping, or chunk at boundaries that don't split tags or entities.

## 4. Inline keyboards and callback queries (multiple-choice and approve/deny)

* `InlineKeyboardButton.callback_data`: "Data to be sent in a callback query to the bot when the button is pressed, **1-64 bytes**" ([api#inlinekeyboardbutton](https://core.telegram.org/bots/api#inlinekeyboardbutton)). → Don't put question text or labels in it. Use a compact token such as `a:<reqId>:<optIdx>` with a short random `reqId` (e.g. 8 base32 chars) and look the rest up in SQLite. Anthropic's plugin uses `perm:allow:<5-letter id>`.
* On press, the bot receives `Update.callback_query` (`id`, `from`, `message`, `data`).
* **`answerCallbackQuery` is mandatory**: "After the user presses a callback button, Telegram clients will display a progress bar until you call answerCallbackQuery. It is, therefore, necessary to react by calling answerCallbackQuery even if no notification to the user is needed" ([api#inlinekeyboardbutton](https://core.telegram.org/bots/api#inlinekeyboardbutton)). Parameters are `callback_query_id`, `text` (0–200 characters), `show_alert` ([api#answercallbackquery](https://core.telegram.org/bots/api#answercallbackquery)).
* Multi-select AskUserQuestion: toggle state server-side and redraw with `editMessageReplyMarkup` (checkmarks), with a final "Submit" button.
* Stale buttons: when a question was already answered locally or timed out, answer the callback with "Already answered" and edit the message. This is the idempotency check.

## 5. Mapping free-text replies to a pending question

* **`ForceReply`**: "Telegram clients will display a reply interface to the user (act as if the user has selected the bot's message and tapped 'Reply')". Fields: `force_reply: true`, `input_field_placeholder` (1–64 characters), `selective` ([api#forcereply](https://core.telegram.org/bots/api#forcereply)).
* The incoming `Message.reply_to_message` holds "the original message" for replies in the same chat and thread ([api#message](https://core.telegram.org/bots/api#message)). → Store `(chat_id, prompt_message_id) → request_id` in SQLite. When a text message arrives with `reply_to_message.message_id`, resolve it to the pending request. Fall back to "latest pending request in this chat/topic" only if exactly one is pending.
* An "Other…" button for AskUserQuestion can send a ForceReply prompt whose answer becomes `answers[question] = "<free text>"`.

## 6. Per-session threads with forum topics

* `createForumTopic(chat_id, name (1–128 characters), icon_color?, icon_custom_emoji_id?)` returns a `ForumTopic` with `message_thread_id`. It works "in a forum supergroup chat **or a private chat with a user**". In a supergroup the bot must be an admin with `can_manage_topics` ([api#createforumtopic](https://core.telegram.org/bots/api#createforumtopic)).
* Private-chat topics need the bot's forum topic mode. `getMe` returns `has_topics_enabled` ("True, if the bot has forum topic mode enabled in private chats"), and a related flag says whether users may create or delete topics ([api#user](https://core.telegram.org/bots/api#user)). **UNVERIFIED:** the exact BotFather step to enable it. Check BotFather or the Bot API changelog.
* Related methods: `editForumTopic`, `closeForumTopic`, `reopenForumTopic`, `deleteForumTopic` ([api](https://core.telegram.org/bots/api#forum-topic-management)).
* Design: **one topic per Claude session** (name it from the session title, cwd basename, and the first 8 characters of the session id). Send every message for that session with `message_thread_id`. Close the topic on `SessionEnd`. ccbot uses exactly this "1 topic = 1 session" mapping ([six-ddc/ccbot](https://github.com/six-ddc/ccbot)).
* Fallback without topics: one DM chat, with each message prefixed by a session tag and reply-to threading.

## 7. Rate limits (Bots FAQ)

From [faq#my-bot-is-hitting-limits-how-do-i-avoid-this](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this):
* "In a single chat, avoid sending more than **one message per second**. We may allow short bursts … eventually you'll begin receiving 429 errors."
* "In a group, bots are not be able to send more than **20 messages per minute**."
* Bulk: about **30 messages per second** across users (paid broadcasts allow more).
* → Coalesce progress updates. Prefer editing one "status" message (`editMessageText`) over sending many messages. Honor `retry_after` on 429.

## 8. Restricting access

* Gate on **`message.from.id`** / `callback_query.from.id` (the user), not just `chat.id`. Anthropic's channel docs say the same: "Gate on the sender's identity, not the chat or room identity … In group chats, these differ" ([channels-reference#gate-inbound-messages](https://code.claude.com/docs/en/channels-reference)). `Message.from` "may be empty for messages sent to channels" ([api#message](https://core.telegram.org/bots/api#message)), so drop those.
* Configure an allowlist with your numeric user id (and the chat id or supergroup id). Silently drop everything else, and optionally log it.
* Optionally use a pairing flow like the official plugin's (the bot replies with a code that you confirm locally) ([channels#security](https://code.claude.com/docs/en/channels)).
* The bot token is a full credential. Store it with `0600` permissions (the official plugin uses `~/.claude/channels/telegram/.env` and a `0o700` state dir). Never log it, and never put it in the URL of an error message.

## 9. Library choice: grammY vs Telegraf

| | grammY | Telegraf |
| :- | :- | :- |
| Latest release | v1.46.0, 2026-08-26 ([GitHub releases](https://github.com/grammyjs/grammY/releases), [npm](https://www.npmjs.com/package/grammy)) | v4.16.3, **2024-02-29** ([GitHub releases](https://github.com/telegraf/telegraf/releases), [npm](https://www.npmjs.com/package/telegraf)) |
| Runtimes | Node, Deno, Bun. A webhook adapter for `Bun.serve` is listed in the deployment guide ([grammy.dev/guide/deployment-types](https://grammy.dev/guide/deployment-types)) | Node-focused |
| Long polling | `bot.start()` processes updates sequentially, "very easy to debug". `@grammyjs/runner` adds concurrency ([deployment-types](https://grammy.dev/guide/deployment-types), [plugins/runner](https://grammy.dev/plugins/runner)) | `bot.launch()` |
| Flood control | `@grammyjs/auto-retry` "is everything you need to handle flood limits, i.e. errors with code 429" ([plugins/auto-retry](https://grammy.dev/plugins/auto-retry)). `@grammyjs/transformer-throttler` ([plugins/transformer-throttler](https://grammy.dev/plugins/transformer-throttler)) | manual |
| Used by Anthropic's official Telegram channel plugin | **Yes** (`import { Bot, GrammyError, InlineKeyboard } from 'grammy'`, [server.ts](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram)) | No |

**Recommendation: grammY.** It's actively maintained and tracks current Bot API versions (Telegraf has had no release since Feb 2024). It's TypeScript-first, runs on Bun, and has `InlineKeyboard` helpers and the auto-retry and throttler plugins. It's also the library Anthropic's own Telegram channel uses. Use plain `bot.start()` (sequential) for a single-user bridge. Sequential handling also simplifies first-answer-wins logic.

## 10. Minimal grammY sketch (Bun)

```ts
import { Bot, InlineKeyboard } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
bot.api.config.use(autoRetry());
const ALLOWED_USER = Number(process.env.TELEGRAM_ALLOWED_USER_ID);

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER) {
    return; // silently drop
  }
  await next();
});

bot.on("callback_query:data", async (ctx) => {
  const [kind, reqId, opt] = ctx.callbackQuery.data.split(":"); // <= 64 bytes total
  const won = resolvePending(reqId, { via: "telegram", option: Number(opt) }); // first-answer-wins in SQLite
  await ctx.answerCallbackQuery({ text: won ? "Sent to Claude" : "Already answered" });
  await ctx.editMessageReplyMarkup(); // remove buttons
});

bot.on("message:text", async (ctx) => {
  const replyTo = ctx.message.reply_to_message?.message_id;
  routeFreeText(ctx.chat.id, ctx.message.message_thread_id, replyTo, ctx.message.text);
});

bot.start({ allowed_updates: ["message", "callback_query"] }); // long polling
```
