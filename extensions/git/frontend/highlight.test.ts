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
})
