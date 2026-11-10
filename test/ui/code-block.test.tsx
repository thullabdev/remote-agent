import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CodeBlock, copyToClipboard } from '../../src/ui/components/code-block.tsx'

describe('code block copy button', () => {
  test('renders a copy button next to the code it copies', () => {
    const markup = renderToStaticMarkup(createElement(CodeBlock, { preClassName: 'p-3', children: 'npm test' }))

    expect(markup).toContain('aria-label="Copy code"')
    expect(markup).toContain('<pre class="p-3">npm test</pre>')
  })

  test('copies the text of the code block', async () => {
    const written: string[] = []
    const ok = await copyToClipboard('npm test', { writeText: async text => { written.push(text) } })

    expect(ok).toBe(true)
    expect(written).toEqual(['npm test'])
  })

  test('reports failure when the clipboard rejects the write', async () => {
    const ok = await copyToClipboard('secret', { writeText: async () => { throw new Error('denied') } })

    expect(ok).toBe(false)
  })

  test('reports failure when no clipboard is available', async () => {
    expect(await copyToClipboard('text', undefined)).toBe(false)
  })
})

test('every code block carries the code-block class that the wrap preference styles', () => {
  const markup = renderToStaticMarkup(createElement(CodeBlock, { children: 'x' }))
  expect(markup).toContain('class="code-block ')
})
