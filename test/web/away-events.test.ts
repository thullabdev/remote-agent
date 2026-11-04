import { beforeEach, expect, test } from 'bun:test'
import { Inbound } from '../../src/bridge/inbound.ts'
import { AwayMode, Notifier } from '../../src/bridge/notifier.ts'
import { PromptService } from '../../src/bridge/prompts.ts'
import { Store } from '../../src/bridge/store.ts'
import { createApi } from '../../src/web/api.ts'
import { bindAway } from '../../src/web/away-events.ts'
import { ChatLog } from '../../src/web/chat-log.ts'
import type { ServerEvent } from '../../src/web/protocol.ts'
import { WebChannel } from '../../src/web/web-channel.ts'

let store: Store
let chatLog: ChatLog
let away: AwayMode

function awayEvents(events: ServerEvent[]): boolean[] {
  return events.flatMap(event => (event.type === 'away.updated' ? [event.away] : []))
}

beforeEach(() => {
  store = new Store(':memory:')
  chatLog = new ChatLog(store)
  away = new AwayMode(false)
})

test('chatLog.recordAway appends an away.updated event to the feed', () => {
  const before = chatLog.currentSeq()

  const event = chatLog.recordAway(true)

  expect(event).toEqual({ type: 'away.updated', seq: before + 1, away: true })
  expect(chatLog.eventsAfter(before)).toEqual([event])
})

test('bindAway records each change as an away.updated event until unbound', () => {
  const events: ServerEvent[] = []
  chatLog.subscribe(event => events.push(event))

  const unbind = bindAway(away, chatLog)
  away.set(true)
  away.set(true)
  unbind()
  away.set(false)

  expect(awayEvents(events)).toEqual([true])
})

test('/away then /back then PUT /api/away broadcast three away.updated events in order', async () => {
  const channel = new WebChannel(chatLog, () => {}, store)
  const notifier = new Notifier(store, channel, away, () => {}, channel)
  const inbound = new Inbound(store, new PromptService(store, notifier, { reminderAfterMs: 60_000 }), notifier)
  const api = createApi({
    chatLog,
    handlers: () => null,
    store,
    away,
    spawner: { end: async () => 'Session ended.' },
    sink: channel,
    log: () => {},
  })
  bindAway(away, chatLog)
  const events: ServerEvent[] = []
  chatLog.subscribe(event => events.push(event))

  await inbound.onCommand({ name: 'away', args: '', thread: null })
  await inbound.onCommand({ name: 'back', args: '', thread: null })
  const response = await api(
    new Request('http://localhost/api/away', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ away: true }) }),
  )

  expect(response?.status).toBe(200)
  expect(awayEvents(events)).toEqual([true, false, true])
})
