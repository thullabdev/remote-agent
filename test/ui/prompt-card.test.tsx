import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../src/channel/web/protocol.ts'
import { PromptCard, type PromptFeedback } from '../../src/ui/components/message-feed.tsx'

type PromptMessage = Extract<Message, { kind: 'prompt' }>

const question = (over: Partial<PromptMessage> = {}, answered: string | null = null, multiSelect = false): PromptMessage => ({
  id: 'm1', chatId: 'c1', seq: 1, at: 1, kind: 'prompt', promptId: 'p1', title: 'Billing fix', status: 'pending', resolution: null,
  body: {
    kind: 'question',
    questions: [{
      question: 'Where should drafts go?', header: 'Drafts', multiSelect, answered,
      options: [{ label: 'Very top', description: 'Above everything' }, { label: 'After blocked', description: '' }, { label: 'No reordering', description: '' }],
    }],
  },
  ...over,
})

const permission = (over: Partial<PromptMessage> = {}): PromptMessage => ({
  id: 'm2', chatId: 'c1', seq: 2, at: 2, kind: 'prompt', promptId: 'p2', title: 'Billing fix', status: 'pending', resolution: null,
  body: { kind: 'permission', tool: 'Bash', summary: '$ bun test', reason: null, agentId: null },
  ...over,
})

function render(message: PromptMessage, initialFeedback?: PromptFeedback): string {
  return renderToStaticMarkup(
    createElement(PromptCard, {
      message, questionIndex: 0, onAction: async () => {}, onReply: async () => {}, ...(initialFeedback === undefined ? {} : { initialFeedback }),
    }),
  )
}

test('a waiting question offers its options, and nothing says an answer was sent', () => {
  const markup = render(question())
  for (const label of ['Very top', 'After blocked', 'No reordering']) {
    expect(markup).toContain(label)
  }
  expect(markup).not.toContain('Sending')
  expect(markup).not.toContain('role="status"')
})

test('while an answer is sending, the tapped option is marked as sending and the others are held back', () => {
  const markup = render(question(), { phase: 'sending', key: 'option:1' })
  expect(markup).toContain('data-choice="sending"')
  expect(markup.match(/data-choice="sending"/g)).toHaveLength(1)
  expect(markup).toMatch(/data-choice="sending"[^>]*>(?:(?!<\/button>)[\s\S])*After blocked/)
  expect(markup).toContain('Sending your answer')
  expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3)
})

test('once sent, the tapped option stays marked and the card says it is waiting for the session', () => {
  const markup = render(question(), { phase: 'sent', key: 'option:2' })
  expect(markup).toContain('data-choice="sent"')
  expect(markup).toMatch(/data-choice="sent"[^>]*>(?:(?!<\/button>)[\s\S])*No reordering/)
  expect(markup).toContain('Sent')
  expect(markup).toContain('Waiting for the session')
})

test('a failed send shows why and leaves the options usable so the user can try again', () => {
  const markup = render(question(), { phase: 'error', message: 'The bridge is not running.' })
  expect(markup).toContain('The bridge is not running.')
  expect(markup).toContain('role="alert"')
  expect(markup).not.toContain('data-choice=')
  expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>\s*<span[^>]*>Very top/)
})

test('a permission request names what is happening to the button that was pressed', () => {
  const allowing = render(permission(), { phase: 'sending', key: 'allow' })
  expect(allowing).toContain('Allowing')
  expect(allowing).toContain('Sending your answer')
  const denied = render(permission(), { phase: 'sent', key: 'deny' })
  expect(denied).toContain('Denied')
  expect(denied).toContain('Waiting for the session')
})

test('an answered question shows what was chosen, with the chosen option marked and the others muted', () => {
  const markup = render(question({ status: 'answered', resolution: { note: 'Answered: After blocked', source: 'remote' } }, 'After blocked'))
  expect(markup).toContain('You answered')
  expect(markup.match(/data-chosen="true"/g)).toHaveLength(1)
  expect(markup).toMatch(/data-chosen="true"[^>]*>(?:(?!<\/div>)[\s\S])*After blocked/)
  expect(markup).not.toContain('Write an answer')
  expect(markup).not.toContain('Sending')
})

test('a typed answer that is not one of the options is shown as written', () => {
  const markup = render(question({ status: 'answered', resolution: { note: 'Answered: use staging', source: 'remote' } }, 'use staging'))
  expect(markup).toContain('use staging')
  expect(markup).not.toContain('data-chosen="true"')
})

test('an answered question with no recorded answer falls back to the note', () => {
  const markup = render(question({ status: 'answered', resolution: { note: 'Dismissed', source: 'remote' } }, null))
  expect(markup).toContain('Dismissed')
})

test('an answered permission says Allowed or Denied with the feedback, large enough to read', () => {
  const allowed = render(permission({ status: 'answered', resolution: { note: 'Allowed', source: 'remote' } }))
  expect(allowed).toContain('Allowed')
  expect(allowed).not.toContain('Allow</button>')
  const denied = render(permission({ status: 'answered', resolution: { note: 'Denied: use pnpm', source: 'remote' } }))
  expect(denied).toContain('Denied: use pnpm')
})

test('an answer given in the terminal says so once', () => {
  const settled = render(permission({ status: 'answered', resolution: { note: 'Answered in the terminal', source: 'local' } }))
  expect(settled.match(/in the terminal/g)).toHaveLength(1)
  const local = render(permission({ status: 'answered', resolution: { note: 'Allowed', source: 'local' } }))
  expect(local).toContain('in the terminal')
})

test('the answer text is not squeezed into the 12px note: it is at least 14px', () => {
  const markup = render(question({ status: 'answered', resolution: { note: 'Answered: Very top', source: 'remote' } }, 'Very top'))
  expect(markup).toMatch(/data-result="true"[\s\S]*?<p class="text-sm font-medium">Very top<\/p>/)
})
