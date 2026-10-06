import { describe, expect, test } from 'bun:test'
import { BridgeError } from '../../mod/remote-agent/hooks/bridge-client.ts'
import {
  askQuestionsLocally,
  DismissedError,
  pollInstructions,
  resolvePrompt,
  toolInputOf,
  type BridgePort,
  type InstructionState,
} from '../../mod/remote-agent/hooks/flows.ts'
import type { Answer, AnswerState, CreatePromptRequest, Instruction } from '../../mod/remote-agent/hooks/protocol.ts'

const request: CreatePromptRequest = { promptId: 'p:1', session: { sessionId: 's', cwd: '/' }, body: { kind: 'permission', tool: 'Bash', input: { command: 'ls' } } }
const allow: Answer = { kind: 'permission', decision: 'allow' }
const deny: Answer = { kind: 'permission', decision: 'deny' }
const never = <T>() => new Promise<T>(() => {})
const noSleep = async () => {}

class FakeBridge implements BridgePort {
  created = 0
  posted: Answer[] = []
  acked: string[] = []
  createFails = false
  waitQueue: (AnswerState | 'error' | 'hang')[] = []
  postResult: ((answer: Answer) => { accepted: boolean; state: AnswerState }) | null = null
  pending: Instruction[] = []

  async createPrompt(): Promise<AnswerState> {
    this.created += 1
    if (this.createFails) {
      throw new BridgeError('down')
    }
    return { status: 'pending' }
  }
  async waitAnswer(): Promise<AnswerState> {
    const next = this.waitQueue.shift() ?? 'hang'
    if (next === 'error') {
      throw new BridgeError('down')
    }
    if (next === 'hang') {
      return never<AnswerState>()
    }
    return next
  }
  async postLocalAnswer(_id: string, answer: Answer) {
    this.posted.push(answer)
    return this.postResult?.(answer) ?? { accepted: true, state: { status: 'answered' as const, answer, source: 'local' as const } }
  }
  async instructions(): Promise<Instruction[]> {
    return this.pending
  }
  async ackInstruction(id: string): Promise<void> {
    this.acked.push(id)
  }
}

function options(bridge: FakeBridge, localAsk: () => Promise<Answer>, signal = new AbortController().signal) {
  return { bridge, request, localAsk, signal, sleep: noSleep, retryDelayMs: 0 }
}

describe('resolvePrompt', () => {
  test('falls back when the bridge is unreachable', async () => {
    const bridge = new FakeBridge()
    bridge.createFails = true
    let asked = false
    const result = await resolvePrompt(options(bridge, async () => {
      asked = true
      return allow
    }))
    expect(result).toBeNull()
    expect(asked).toBe(false)
  })

  test('remote answer wins while the terminal is untouched', async () => {
    const bridge = new FakeBridge()
    bridge.waitQueue = [{ status: 'pending' }, { status: 'answered', answer: deny, source: 'remote' }]
    expect(await resolvePrompt(options(bridge, () => never<Answer>()))).toEqual(deny)
    expect(bridge.posted).toEqual([])
  })

  test('local answer wins and is posted to the bridge', async () => {
    const bridge = new FakeBridge()
    expect(await resolvePrompt(options(bridge, async () => allow))).toEqual(allow)
    expect(bridge.posted).toEqual([allow])
  })

  test('local answer loses to an earlier remote answer', async () => {
    const bridge = new FakeBridge()
    bridge.postResult = () => ({ accepted: false, state: { status: 'answered', answer: deny, source: 'remote' } })
    expect(await resolvePrompt(options(bridge, async () => allow))).toEqual(deny)
  })

  test('remote polling survives transient errors and re-registers the prompt', async () => {
    const bridge = new FakeBridge()
    bridge.waitQueue = ['error', { status: 'answered', answer: allow, source: 'remote' }]
    expect(await resolvePrompt({ ...options(bridge, () => never<Answer>()), maxFailures: 3 })).toEqual(allow)
    expect(bridge.created).toBe(2)
  })

  test('default failure budget survives five consecutive failures', async () => {
    const bridge = new FakeBridge()
    bridge.waitQueue = ['error', 'error', 'error', 'error', 'error', { status: 'answered', answer: allow, source: 'remote' }]
    expect(await resolvePrompt({ ...options(bridge, () => never<Answer>()), retryDelayMs: undefined })).toEqual(allow)
  })

  test('a dismissed permission dialog becomes a local deny', async () => {
    const bridge = new FakeBridge()
    const result = await resolvePrompt(options(bridge, async () => {
      throw new Error('dismissed')
    }))
    expect(result).toEqual({ kind: 'permission', decision: 'deny', message: 'Dismissed in the terminal.' })
  })

  test('a dismissed question throws DismissedError', async () => {
    const bridge = new FakeBridge()
    const question: CreatePromptRequest = { ...request, promptId: 'q:1', body: { kind: 'question', questions: [] } }
    await expect(
      resolvePrompt({ ...options(bridge, async () => { throw new Error('dismissed') }), request: question }),
    ).rejects.toBeInstanceOf(DismissedError)
    expect(bridge.posted).toEqual([{ kind: 'question', answers: {} }])
  })

  test('aborting the dispatch rejects', async () => {
    const bridge = new FakeBridge()
    const controller = new AbortController()
    const pending = resolvePrompt(options(bridge, () => never<Answer>(), controller.signal))
    controller.abort(new Error('interrupted'))
    await expect(pending).rejects.toThrow('interrupted')
    expect(bridge.posted).toEqual([{ kind: 'permission', decision: 'deny', message: 'Dismissed in the terminal.' }])
  })
})

describe('local asks', () => {
  test('questions are asked in order and keyed by question text', async () => {
    const asked: string[] = []
    const ask = async (question: string, opts: { options: string[]; multiSelect?: true }) => {
      asked.push(`${question}|${opts.options.join('/')}|${opts.multiSelect === true}`)
      return opts.options[0]!
    }
    const answer = await askQuestionsLocally(ask, [
      { question: 'A?', header: 'A header that is long', multiSelect: false, options: [{ label: 'a1', description: '' }, { label: 'a2', description: '' }] },
      { question: 'B?', header: 'B', multiSelect: true, options: [{ label: 'b1', description: '' }, { label: 'b2', description: '' }] },
    ])()
    expect(answer).toEqual({ kind: 'question', answers: { 'A?': 'a1', 'B?': 'b1' } })
    expect(asked).toEqual(['A?|a1/a2|false', 'B?|b1/b2|true'])
  })
})

describe('toolInputOf', () => {
  test('strips the engine\'s own keys and keeps the tool arguments', () => {
    expect(toolInputOf({ tool: 'Bash', tool_use_id: 'toolu_1', agentId: 'a', consent: 'c', command: 'ls', description: 'list' })).toEqual({ command: 'ls', description: 'list' })
  })
  test('keeps nested values untouched', () => {
    expect(toolInputOf({ tool: 'Edit', file_path: '/a', edits: [{ x: 1 }] })).toEqual({ file_path: '/a', edits: [{ x: 1 }] })
  })
})

describe('pollInstructions', () => {
  test('submits each instruction once and acknowledges it', async () => {
    const bridge = new FakeBridge()
    bridge.pending = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    const state: InstructionState = { inFlight: new Set(), submitted: new Set(), delivered: new Set() }
    const submitted: string[] = []
    await pollInstructions(bridge, 's', state, async text => {
      submitted.push(text)
    })
    expect(submitted).toEqual(['go on'])
    expect(bridge.acked).toEqual(['i1'])
  })

  test('does not resubmit while a submission is still waiting for the session to be idle', async () => {
    const bridge = new FakeBridge()
    bridge.pending = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    const state: InstructionState = { inFlight: new Set(), submitted: new Set(), delivered: new Set() }
    let calls = 0
    const submit = () => {
      calls += 1
      return never<void>()
    }
    void pollInstructions(bridge, 's', state, submit)
    await Bun.sleep(5)
    void pollInstructions(bridge, 's', state, submit)
    await Bun.sleep(5)
    expect(calls).toBe(1)
  })

  test('only retries the acknowledgement when ack failed after submit', async () => {
    const bridge = new FakeBridge()
    bridge.pending = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    let failAck = true
    bridge.ackInstruction = async (id: string) => {
      if (failAck) {
        failAck = false
        throw new BridgeError('down')
      }
      bridge.acked.push(id)
    }
    const state: InstructionState = { inFlight: new Set(), submitted: new Set(), delivered: new Set() }
    let submits = 0
    const submit = async () => {
      submits += 1
    }
    await pollInstructions(bridge, 's', state, submit)
    await pollInstructions(bridge, 's', state, submit)
    expect(submits).toBe(1)
    expect(bridge.acked).toEqual(['i1'])
  })

  test('a stale instructions response never resubmits an acknowledged instruction', async () => {
    const bridge = new FakeBridge()
    const listing: Instruction[] = [{ id: 'i1', sessionId: 's', text: 'go on' }]
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let first = true
    bridge.instructions = async () => {
      if (first) {
        first = false
        await gate
      }
      return listing
    }
    const state: InstructionState = { inFlight: new Set(), submitted: new Set(), delivered: new Set() }
    let submits = 0
    const submit = async () => {
      submits += 1
    }
    const pollA = pollInstructions(bridge, 's', state, submit)
    await pollInstructions(bridge, 's', state, submit)
    expect(submits).toBe(1)
    release()
    await pollA
    expect(submits).toBe(1)
    expect(bridge.acked).toEqual(['i1'])
  })
})
