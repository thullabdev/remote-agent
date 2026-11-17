import { describe, it, expect, beforeAll, afterEach } from 'bun:test'
import { attach, replayFor, REPLAY_LIMIT_BYTES, type Attachment } from './attach.ts'
import { createSession, hasSession, killSession, runTmux, sessionNameFor } from './tmux.ts'

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out')
    }
    await Bun.sleep(50)
  }
}

describe('attach to a tmux session', () => {
  const names: string[] = []
  const attachments: Attachment[] = []

  beforeAll(async () => {
    await runTmux(['kill-server'])
  })

  afterEach(async () => {
    for (const attachment of attachments.splice(0)) {
      attachment.detach()
    }
    for (const name of names.splice(0)) {
      await killSession(name)
    }
  })

  async function session(): Promise<string> {
    const name = sessionNameFor(`test-attach-${crypto.randomUUID()}`)
    names.push(name)
    await createSession({ name, cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh' })
    return name
  }

  function open(name: string, sink: { output: string; exited: boolean }): Attachment {
    const attachment = attach({
      name,
      cols: 80,
      rows: 24,
      onOutput: data => {
        sink.output += data
      },
      onExit: () => {
        sink.exited = true
      },
    })
    attachments.push(attachment)
    return attachment
  }

  it('shows output from the shell and sends input to it', async () => {
    const name = await session()
    const sink = { output: '', exited: false }
    const client = open(name, sink)

    client.write('echo attached-$((20+22))\r')

    await until(() => sink.output.includes('attached-42'))
    expect(client.closed).toBe(false)
  })

  it('keeps the session running after the client detaches, and replays it on reattach', async () => {
    const name = await session()
    const first = { output: '', exited: false }
    const client = open(name, first)
    client.write('echo before-detach-marker\r')
    await until(() => first.output.includes('before-detach-marker'))

    client.detach()
    await Bun.sleep(200)
    expect(await hasSession(name)).toBe(true)
    expect(client.closed).toBe(true)

    const replay = await replayFor(name)
    expect(replay).toContain('before-detach-marker')
  })

  it('replays scrollback beyond the visible screen, without the oldest lines', async () => {
    const name = await session()
    const sink = { output: '', exited: false }
    const client = open(name, sink)
    client.write("seq 1 3000 | sed 's/^/L/'\r")
    await until(() => sink.output.includes('L3000'))
    client.detach()

    const replay = await replayFor(name)
    const lines = replay.split('\r\n')
    expect(lines).toContain('L3000')
    expect(lines).not.toContain('L1')
    expect(Buffer.byteLength(replay, 'utf8')).toBeLessThanOrEqual(REPLAY_LIMIT_BYTES)
  })

  it('reports exit when the tmux session it is attached to is killed', async () => {
    const name = await session()
    const sink = { output: '', exited: false }
    open(name, sink)
    await Bun.sleep(300)

    await killSession(name)

    await until(() => sink.exited)
    expect(sink.exited).toBe(true)
  })
})
