import { afterEach, expect, test } from 'bun:test'
import { scrollToMessage } from '../../src/ui/components/message-feed.tsx'

// There is no DOM in these tests, so the document and the elements are small stubs.
type Call = { top?: number; behavior?: string; block?: string }

function stubs(options: { inFeed: boolean }) {
  const feedScrolls: Call[] = []
  const elementScrolls: Call[] = []
  const feed = {
    scrollTop: 200,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 100 }),
    scrollTo: (call: Call) => feedScrolls.push(call),
  }
  const element = {
    closest: () => (options.inFeed ? feed : null),
    getBoundingClientRect: () => ({ top: 500, height: 100 }),
    scrollIntoView: (call: Call) => elementScrolls.push(call),
  }
  Object.assign(globalThis, { document: { getElementById: (id: string) => (id === 'message-m1' ? element : null) } })
  return { feedScrolls, elementScrolls }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
})

test('scrolls only the feed, to the middle of the message, and never scrolls the wrapper around it', () => {
  const { feedScrolls, elementScrolls } = stubs({ inFeed: true })
  expect(scrollToMessage('m1')).toBe(true)
  // The message sits 400px below the feed's top and is 100px tall; the feed is 400px tall and already scrolled by 200.
  expect(feedScrolls).toEqual([{ top: 450, behavior: 'smooth' }])
  expect(elementScrolls).toEqual([])
})

test('never scrolls above the top of the feed', () => {
  const { feedScrolls } = stubs({ inFeed: true })
  Object.assign(globalThis, {
    document: {
      getElementById: () => ({
        closest: () => ({
          scrollTop: 0,
          clientHeight: 400,
          getBoundingClientRect: () => ({ top: 100 }),
          scrollTo: (call: Call) => feedScrolls.push(call),
        }),
        getBoundingClientRect: () => ({ top: 120, height: 40 }),
        scrollIntoView: () => {},
      }),
    },
  })
  expect(scrollToMessage('m1')).toBe(true)
  expect(feedScrolls.at(-1)?.top).toBe(0)
})

test('falls back to scrollIntoView for a message that is not inside a feed', () => {
  const { feedScrolls, elementScrolls } = stubs({ inFeed: false })
  expect(scrollToMessage('m1')).toBe(true)
  expect(feedScrolls).toEqual([])
  expect(elementScrolls).toEqual([{ block: 'center', behavior: 'smooth' }])
})

test('says so when the message is not loaded', () => {
  stubs({ inFeed: true })
  expect(scrollToMessage('missing')).toBe(false)
})
