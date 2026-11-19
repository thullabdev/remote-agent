import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuoteEditor } from '../../src/ui/components/quote-comment.tsx'

function render(quote: string, source: string): string {
  return renderToStaticMarkup(createElement(QuoteEditor, { quote, source, onSave: () => {}, onCancel: () => {} }))
}

test('the quote editor shows the quoted text, escaped, under its source label', () => {
  const markup = render('exit 0 && echo <done>', 'Bash result')
  expect(markup).toContain('Quote · Bash result')
  expect(markup).toContain('exit 0 &amp;&amp; echo &lt;done&gt;')
  expect(markup).toContain('aria-label="Comment on quote from Bash result"')
})

test('a multi-line quote keeps its lines in the clipped quote block', () => {
  const markup = render('first line\nsecond line', 'Agent message')
  expect(markup).toContain('<blockquote')
  expect(markup).toContain('first line\nsecond line')
  expect(markup).toContain('max-h-24')
})

test('the editor has a comment textarea and a Save button that starts disabled while the comment is empty', () => {
  const markup = render('some text', 'Your message')
  expect(markup).toContain('aria-label="Comment text"')
  expect(markup).toContain('placeholder="Comment on this quote"')
  expect(markup).toMatch(/<button[^>]*aria-label="Save comment"[^>]*disabled/)
  expect(markup).toContain('>Cancel<')
})
