import { expect, test } from 'bun:test'
import type { Message } from '../../src/channel/web/protocol.ts'
import { revealMessage, type RevealDeps, type RevealTarget } from '../../src/ui/reveal.ts'

const reply = (id: string, seq: number): Message => ({ id, chatId: 'c1', seq, at: seq, pinned: false, kind: 'agent_text', markdown: id })

const at = (id: string, seq?: number | null): RevealTarget => ({
  chatId: 'c1',
  seq,
  find: messages => messages.find(message => message.id === id),
})

/**
 * A chat with pages newest first, the first page already loaded (or arriving after `loadedAfter` waits). `loadOlder` shifts the next
 * page onto the loaded ones, and `scrollTo` only succeeds once `renderAfter` attempts have been made, to stand in for React rendering.
 */
function harness(options: { pages: Message[][]; loadedAfter?: number; renderAfter?: number; hiddenBefore?: number }) {
  const newest = options.pages[0] ?? []
  const older = options.pages.slice(1)
  const loadedAfter = options.loadedAfter ?? 0
  const renderAfter = options.renderAfter ?? 0
  let waited = 0
  let attempts = 0
  let loaded = loadedAfter === 0 ? [...newest] : []
  const opens: string[] = []
  const loads: number[] = []
  const scrolled: string[] = []
  let notFound = 0

  const deps: RevealDeps = {
    openChat: chatId => {
      opens.push(chatId)
    },
    isLoaded: () => waited >= loadedAfter,
    messages: () => loaded,
    hasMore: () => older.length > 0,
    hiddenBefore: () => options.hiddenBefore ?? 0,
    loadOlder: async (_chatId, before) => {
      loads.push(before)
      loaded = [...(older.shift() ?? []), ...loaded]
    },
    scrollTo: messageId => {
      attempts += 1
      if (attempts <= renderAfter || !loaded.some(message => message.id === messageId)) {
        return false
      }
      scrolled.push(messageId)
      return true
    },
    wait: async () => {
      waited += 1
      if (waited === loadedAfter) {
        loaded = [...newest]
      }
    },
    notFound: () => {
      notFound += 1
    },
  }

  return { deps, opens, loads, scrolled, notFound: () => notFound }
}

test('reveals a message that is already loaded without opening another page', async () => {
  const chat = harness({ pages: [[reply('m1', 1), reply('m2', 2)]] })

  expect(await revealMessage(chat.deps, at('m2', 2))).toBe(true)
  expect(chat.opens).toEqual(['c1'])
  expect(chat.loads).toEqual([])
  expect(chat.scrolled).toEqual(['m2'])
  expect(chat.notFound()).toBe(0)
})

test('waits for the chat\'s first page before scrolling', async () => {
  const chat = harness({ pages: [[reply('m5', 5)]], loadedAfter: 3 })

  expect(await revealMessage(chat.deps, at('m5', 5))).toBe(true)
  expect(chat.opens).toEqual(['c1'])
  expect(chat.scrolled).toEqual(['m5'])
})

test('loads older pages until the loaded range covers the message\'s seq, and no further', async () => {
  const chat = harness({
    pages: [[reply('m5', 5), reply('m6', 6)], [reply('m3', 3), reply('m4', 4)], [reply('m1', 1), reply('m2', 2)]],
  })

  expect(await revealMessage(chat.deps, at('m2', 2))).toBe(true)
  expect(chat.loads).toEqual([5, 3])
  expect(chat.scrolled).toEqual(['m2'])
})

test('does not load a page the loaded range already covers, even when the message is gone', async () => {
  const chat = harness({ pages: [[reply('m5', 5)], [reply('m1', 1)]] })

  expect(await revealMessage(chat.deps, at('gone', 5))).toBe(false)
  expect(chat.loads).toEqual([])
  expect(chat.notFound()).toBe(1)
})

test('says so instead of paging for a message a cleared history hides', async () => {
  const chat = harness({ pages: [[reply('m50', 50)], [reply('m1', 1)]], hiddenBefore: 10 })

  expect(await revealMessage(chat.deps, at('m5', 5))).toBe(false)
  expect(chat.loads).toEqual([])
  expect(chat.notFound()).toBe(1)
})

test('waits for a loaded page to render before saying the message is missing', async () => {
  const chat = harness({ pages: [[reply('m5', 5)], [reply('m1', 1)]], renderAfter: 2 })

  expect(await revealMessage(chat.deps, at('m1', 1))).toBe(true)
  expect(chat.loads).toEqual([5])
  expect(chat.scrolled).toEqual(['m1'])
  expect(chat.notFound()).toBe(0)
})

test('paging without a seq stops once the message is found', async () => {
  const chat = harness({ pages: [[reply('m5', 5)], [reply('m3', 3), reply('m4', 4)], [reply('m1', 1)]] })

  expect(await revealMessage(chat.deps, at('m3'))).toBe(true)
  expect(chat.loads).toEqual([5])
  expect(chat.scrolled).toEqual(['m3'])
})

test('reports a message that is in no page, after every page is loaded', async () => {
  const chat = harness({ pages: [[reply('m5', 5)], [reply('m1', 1)]] })

  expect(await revealMessage(chat.deps, at('gone'))).toBe(false)
  expect(chat.loads).toEqual([5])
  expect(chat.notFound()).toBe(1)
})
