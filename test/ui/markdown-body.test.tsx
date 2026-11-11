import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import MarkdownBody from '../../src/ui/components/markdown-body.tsx'

describe('agent markdown rendering', () => {
  test('tables wrap their text first and scroll inside their wrapper only when columns still do not fit', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, {
      markdown: '| First | Second |\n| --- | --- |\n| A | B |',
    }))

    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('overscroll-x-contain')
    expect(markup).toContain('<table class="w-full ')
    expect(markup).not.toContain('w-max')
    expect(markup).toContain('[&amp;_td]:min-w-24')
    expect(markup).toContain('<th>First</th>')
  })

  test('wraps code blocks in a horizontally scrollable container', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, {
      markdown: '```text\n' + 'a'.repeat(200) + '\n```',
    }))

    expect(markup).toContain('overflow-x-auto')
    expect(markup).toContain('overscroll-x-contain')
    expect(markup).toContain('<pre class="m-0 w-max min-w-full p-3 pr-11 ')
    expect(markup).toContain('a'.repeat(200))
  })

  test('the code block frame is on the wrapper, so the box stays put and only the code scrolls inside it', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, { markdown: '```text\nx\n```' }))
    const frame = markup.match(/<div class="([^"]*not-prose[^"]*)"/)?.[1] ?? ''
    expect(frame).toContain('rounded-xl')
    expect(frame).toContain('border')
    expect(frame).toContain('bg-muted')
    expect(frame).toContain('overflow-hidden')
    expect(markup.match(/<pre class="([^"]*)"/)?.[1]).not.toMatch(/bg-|border|rounded/)
  })

  test('adds a copy button to every code block', () => {
    const markup = renderToStaticMarkup(createElement(MarkdownBody, {
      markdown: '```ts\nconst a = 1\n```\n\n```text\nb\n```',
    }))

    expect(markup.match(/aria-label="Copy code"/g)).toHaveLength(2)
  })
})
