import { describe, it, expect } from 'bun:test'
import { createSessionEvents, frameOf } from './events.ts'
import type { SessionView } from './routes.ts'

const view: SessionView = { sid: 'term-a', cwd: '/work/api', project: 'api', chatId: null, createdAt: 1, lastAttachedAt: null, attached: false, command: null }

function fakeSocket() {
  const frames: string[] = []
  return { frames, send: (data: string) => void frames.push(data) }
}

describe('session events', () => {
  it('sends the whole list to every subscriber', () => {
    const events = createSessionEvents()
    const first = fakeSocket()
    const second = fakeSocket()
    events.add(first)
    events.add(second)

    events.publish([view])

    expect(first.frames).toEqual([frameOf([view])])
    expect(second.frames).toEqual([frameOf([view])])
  })

  it('stops sending to a subscriber that removed itself', () => {
    const events = createSessionEvents()
    const socket = fakeSocket()
    events.add(socket)
    events.remove(socket)

    events.publish([])

    expect(socket.frames).toEqual([])
    expect(events.count()).toBe(0)
  })

  it('drops a subscriber whose socket throws, and keeps the others', () => {
    const events = createSessionEvents()
    const broken = { send: () => {
      throw new Error('closed')
    } }
    const healthy = fakeSocket()
    events.add(broken)
    events.add(healthy)

    events.publish([view])

    expect(healthy.frames).toHaveLength(1)
    expect(events.count()).toBe(1)
  })

  it('frames the list with a type the browser can recognise', () => {
    expect(JSON.parse(frameOf([view]))).toEqual({ type: 'sessions', sessions: [view] })
  })
})
