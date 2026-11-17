import { describe, expect, test } from 'bun:test'
import { escapeHtml, highlightLine, languageOf } from './highlight.ts'

describe('highlight', () => {
  test('languageOf maps extensions and falls back to text', () => {
    expect(languageOf('a/b.tsx')).toBe('tsx')
    expect(languageOf('x.unknownext')).toBe('text')
  })

  test('escapeHtml escapes markup', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  test('highlightLine escapes output when the language is unknown', async () => {
    const html = await highlightLine('<b>', 'text')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  test('highlightLine escapes output when the shiki language is unknown', async () => {
    const html = await highlightLine('<b>', 'nope-lang')
    expect(html).toBe('&lt;b&gt;')
  })

  test('highlightLine returns an inline fragment from the real shiki path', async () => {
    const html = await highlightLine('const a = 1', 'typescript')
    expect(html).toContain('<span')
    expect(html.startsWith('<pre')).toBe(false)
    expect(html.includes('<code')).toBe(false)
  })
})

describe('highlight theme output', () => {
  test('highlighted spans carry both theme colours as CSS variables and no background', async () => {
    const html = await highlightLine('const a = 1', 'typescript')
    expect(html).toContain('--shiki-light:')
    expect(html).toContain('--shiki-dark:')
    expect(html).not.toContain('background')
  })
})
