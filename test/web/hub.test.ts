import { beforeEach, expect, test } from 'bun:test'
import { Hub, type HubSocket } from '../../src/web/hub.ts'
import { ChatLog } from '../../src/web/chat-log.ts'
import { Store } from '../../src/bridge/store.ts'
import type { ServerEvent } from '../../src/web/protocol.ts'

class FakeSocket implements HubSocket {
  sent: string[] = []
  closed: { code: number | undefined; reason: string | undefined } | null = null
  buffered = 0
  throwOnSend = false
  throwOnClose = false

  send(data: string): void {
    if (this.throwOnSend) {
      throw new Error('socket is gone')
    }
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    if (this.throwOnClose) {
      throw new Error('close failed')
    }
    this.closed = { code, reason }
  }

  getBufferedAmount(): number {
    return this.buffered
  }
}

let clock = 1_000
let chatLog: ChatLog
let hub: Hub

beforeEach(() => {
  clock = 1_000
  chatLog = new ChatLog(new Store(':memory:', () => clock), () => clock)
  hub = new Hub(chatLog, () => clock)
})

test('broadcast sends each event as JSON to every client, and remove stops delivery', () => {
  const first = new FakeSocket()
  const second = new FakeSocket()
  const firstId = hub.add(first)
  hub.add(second)
  const event: ServerEvent = { type: 'away.updated', seq: 7, away: true }

  hub.broadcast(event)
  hub.remove(firstId)
  hub.broadcast({ type: 'away.updated', seq: 8, away: false })

  expect(first.sent).toEqual([JSON.stringify(event)])
  expect(second.sent.map(data => JSON.parse(data).seq)).toEqual([7, 8])
})

test('anyActive is true only while a client is visible and focused', () => {
  const socket = new FakeSocket()
  const id = hub.add(socket)
  expect(hub.anyActive()).toBe(false)

  hub.setPresence(id, { visible: true, focused: false, chatId: 'general' })
  expect(hub.anyActive()).toBe(false)

  hub.setPresence(id, { visible: true, focused: true, chatId: 'general' })
  expect(hub.anyActive()).toBe(true)

  hub.remove(id)
  expect(hub.anyActive()).toBe(false)
})

test('replay sends the events after the given seq in order, one per frame', () => {
  chatLog.createChat({ id: 'a', sessionId: null, title: 'A' })
  chatLog.appendMessage('general', { kind: 'system', text: 'one' })
  chatLog.appendMessage('general', { kind: 'system', text: 'two' })
  const socket = new FakeSocket()
  const id = hub.add(socket)

  hub.replay(id, 0)

  const seqs = socket.sent.map(data => JSON.parse(data).seq)
  expect(seqs).toEqual([...seqs].sort((left, right) => left - right))
  expect(socket.sent.length).toBeGreaterThan(1)
  expect(socket.sent.every(data => typeof JSON.parse(data).type === 'string')).toBe(true)
})

test('replay sends resync when the client is ahead of the server', () => {
  const socket = new FakeSocket()
  const id = hub.add(socket)

  hub.replay(id, chatLog.currentSeq() + 100)

  expect(socket.sent).toEqual([JSON.stringify({ type: 'resync' })])
})

test('a client whose buffer is over 8 MB is closed with 1013 and removed', () => {
  const slow = new FakeSocket()
  const healthy = new FakeSocket()
  hub.add(slow)
  hub.add(healthy)
  slow.buffered = 8 * 1024 * 1024 + 1

  hub.broadcast({ type: 'away.updated', seq: 1, away: true })

  expect(slow.closed).toEqual({ code: 1013, reason: expect.any(String) })
  expect(slow.sent).toEqual([])
  expect(healthy.sent.length).toBe(1)
})

test('a client whose send throws is removed and does not stop the others', () => {
  const broken = new FakeSocket()
  const healthy = new FakeSocket()
  broken.throwOnSend = true
  hub.add(broken)
  hub.add(healthy)

  expect(() => hub.broadcast({ type: 'away.updated', seq: 1, away: true })).not.toThrow()
  hub.broadcast({ type: 'away.updated', seq: 2, away: false })

  expect(healthy.sent.length).toBe(2)
})

test('a client that misses pings is dropped', () => {
  const silent = new FakeSocket()
  const answering = new FakeSocket()
  hub.add(silent)
  const answeringId = hub.add(answering)

  clock += 60_000
  hub.touch(answeringId)
  clock += 60_000

  expect(hub.reapStale(90_000)).toBe(1)
  expect(silent.closed).not.toBeNull()
  expect(answering.closed).toBeNull()
  expect(hub.reapStale(90_000)).toBe(0)
})

test('a socket whose close throws does not break broadcast to other clients', () => {
  const slow = new FakeSocket()
  slow.buffered = 8 * 1024 * 1024 + 1
  slow.throwOnClose = true
  const healthy = new FakeSocket()
  hub.add(slow)
  hub.add(healthy)

  expect(() => hub.broadcast({ type: 'away.updated', seq: 1, away: true })).not.toThrow()
  expect(healthy.sent.length).toBe(1)

  const stale = new FakeSocket()
  stale.throwOnClose = true
  hub.add(stale)
  clock += 200_000
  expect(() => hub.reapStale(90_000)).not.toThrow()
  expect(hub.clientCount()).toBe(0)
})

test('a throwing send removes the client and closes its socket', () => {
  const broken = new FakeSocket()
  broken.throwOnSend = true
  hub.add(broken)

  hub.broadcast({ type: 'away.updated', seq: 1, away: true })

  expect(broken.closed).toEqual({ code: 1011, reason: expect.any(String) })
  expect(hub.clientCount()).toBe(0)
})
