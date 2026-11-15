import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageRows } from '../../src/ui/components/message-feed.tsx'
import { subagentMessages } from '../../src/ui/subagent-messages.ts'

test('a sub-agent\'s activity is drawn with the chat\'s own tool group and message rows', () => {
  const messages = subagentMessages('c1', [
    { kind: 'user_text', text: 'Review the spike.' },
    { kind: 'tool_use', toolUseId: 't1', tool: 'Read', input: { file_path: 'a.ts' } },
    { kind: 'tool_result', toolUseId: 't1', text: 'file body', isError: false },
  ])
  const html = renderToStaticMarkup(createElement(MessageRows, { chatId: 'c1', messages }))
  // The same wording the main chat uses for a finished tool group, and the same prompt bubble.
  expect(html).toContain('Agent activity')
  expect(html).toContain('Review the spike.')
  expect(html).toContain('Read')
})

const withTool = subagentMessages('c1', [
  { kind: 'tool_use', toolUseId: 't1', tool: 'Read', input: { file_path: 'a.ts' } },
  { kind: 'tool_result', toolUseId: 't1', text: 'file body', isError: false },
])

test('expandAll opens the tool group and its steps by default, and the chat does not', () => {
  const open = renderToStaticMarkup(createElement(MessageRows, { chatId: 'c1', messages: withTool, expandAll: true }))
  expect(open).toContain('aria-expanded="true"')
  expect(open).toContain('file body')
  const closed = renderToStaticMarkup(createElement(MessageRows, { chatId: 'c1', messages: withTool }))
  expect(closed).toContain('aria-expanded="false"')
  expect(closed).not.toContain('file body')
})
