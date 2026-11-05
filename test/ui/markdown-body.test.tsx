import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownBody from '../../src/ui/components/markdown-body.tsx'

describe('agent markdown rendering', () => {
  test('wraps tables in a horizontally scrollable container', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, {
      markdown: '| First | Second |\n| --- | --- |\n| A | B |',
    }))

    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('overscroll-x-contain')
    expect(markup).toContain('<table class="w-max min-w-full">')
    expect(markup).toContain('<th>First</th>')
  })

  test('wraps code blocks in a horizontally scrollable container', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, {
      markdown: '```text\n' + 'a'.repeat(200) + '\n```',
    }))

    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('overscroll-x-contain')
    expect(markup).toContain('<pre class="m-0 w-max min-w-full">')
    expect(markup).toContain('a'.repeat(200))
  })

  test('adds a copy button to every code block', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, {
      markdown: '```ts\nconst a = 1\n```\n\n```text\nb\n```',
    }))

    expect(markup.match(/aria-label="Copy code"/g)).toHaveLength(2)
  })
})
