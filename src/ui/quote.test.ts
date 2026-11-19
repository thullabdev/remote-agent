import { describe, expect, test } from 'bun:test'
import { buttonPosition, QUOTE_MAX_CHARS, QUOTE_SHORTENED_MARKER, quoteMarkdown, quoteTitle, type SelectionLike, selectionQuote, sourceOf, type Walkable } from './quote.ts'

/** A plain stand-in for a DOM element or text node: just the fields the helpers read. */
type FakeNode = Walkable & { nodeType: number; tagName?: string; isContentEditable?: boolean; parentElement: FakeNode | null; attrs: Record<string, string> }

function element(tag: string, attrs: Record<string, string> = {}, parent: FakeNode | null = null, extra: Partial<FakeNode> = {}): FakeNode {
  const node: FakeNode = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    parentElement: parent,
    getAttribute: name => (name in attrs ? attrs[name] ?? null : null),
    ...extra,
  }
  return node
}

function textIn(parent: FakeNode): FakeNode {
  return element('#text', {}, parent, { nodeType: 3, tagName: undefined })
}

/** A feed with a user message and an agent message, a Bash result block, and an editable box outside the blocks. */
function fixture() {
  const feed = element('div')
  const userBody = element('p', { 'data-quote-source': 'Your message' }, feed)
  const userText = textIn(userBody)
  const agentBody = element('div', { 'data-quote-source': 'Agent message' }, feed)
  const agentText = textIn(agentBody)
  const resultWrap = element('div', { 'data-quote-source': 'Bash result' }, feed)
  const resultPre = element('pre', {}, resultWrap)
  const resultText = textIn(resultPre)
  const textarea = element('textarea', {}, feed)
  const fieldText = textIn(textarea)
  const editable = element('div', { contenteditable: 'true' }, feed, { isContentEditable: true })
  const editableText = textIn(editable)
  const loose = element('span', {}, feed)
  const looseText = textIn(loose)
  return { feed, userBody, userText, agentBody, agentText, resultWrap, resultText, textarea, fieldText, editable, editableText, loose, looseText }
}

function selectionOf(anchorNode: FakeNode | null, focusNode: FakeNode | null, text: string, isCollapsed = false): SelectionLike {
  return { isCollapsed, anchorNode, focusNode, toString: () => text }
}

describe('quoteMarkdown', () => {
  test('every line of the quote is a blockquote line, then a blank line, then the comment', () => {
    expect(quoteMarkdown('first\nsecond', 'please check')).toBe('> first\n> second\n\nplease check')
  })

  test('a single line quote and a comment with surrounding space', () => {
    expect(quoteMarkdown('only', '  looks wrong  ')).toBe('> only\n\nlooks wrong')
  })

  test('CRLF line endings in the quote are split the same way', () => {
    expect(quoteMarkdown('a\r\nb', 'c')).toBe('> a\n> b\n\nc')
  })

  test('an empty line inside the quote keeps its blockquote prefix', () => {
    expect(quoteMarkdown('a\n\nb', 'c')).toBe('> a\n> \n> b\n\nc')
  })
})

describe('quoteTitle', () => {
  test('names the source after "Quote ·"', () => {
    expect(quoteTitle('Bash result')).toBe('Quote · Bash result')
  })
})

describe('sourceOf', () => {
  test('a node in a source block gives the block name', () => {
    const { userText, resultText } = fixture()
    expect(sourceOf(userText)).toBe('Your message')
    expect(sourceOf(resultText)).toBe('Bash result')
  })

  test('the nearest ancestor with the attribute wins', () => {
    const outer = element('div', { 'data-quote-source': 'Edit' })
    const inner = element('div', { 'data-quote-source': 'Write' }, outer)
    const deep = textIn(element('span', {}, inner))
    expect(sourceOf(deep)).toBe('Write')
  })

  test('a node outside every source block has no source', () => {
    const { looseText, feed } = fixture()
    expect(sourceOf(looseText)).toBeNull()
    expect(sourceOf(feed)).toBeNull()
    expect(sourceOf(null)).toBeNull()
  })

  test('an empty source name counts as no source', () => {
    const block = element('div', { 'data-quote-source': '   ' })
    expect(sourceOf(textIn(block))).toBeNull()
  })
})

describe('selectionQuote', () => {
  test('a selection inside one source block gives its text and source', () => {
    const { resultText } = fixture()
    expect(selectionQuote(selectionOf(resultText, resultText, '  exit 0\n  ok  '))).toEqual({ text: 'exit 0\n  ok', source: 'Bash result' })
  })

  test('a selection inside an agent message quotes it as Agent message', () => {
    const { agentText } = fixture()
    expect(selectionQuote(selectionOf(agentText, agentText, 'hi'))).toEqual({ text: 'hi', source: 'Agent message' })
  })

  test('a collapsed or missing selection gives null', () => {
    const { userText } = fixture()
    expect(selectionQuote(null)).toBeNull()
    expect(selectionQuote(selectionOf(userText, userText, '', true))).toBeNull()
    expect(selectionQuote(selectionOf(null, null, 'x'))).toBeNull()
  })

  test('a selection that is only whitespace gives null', () => {
    const { userText } = fixture()
    expect(selectionQuote(selectionOf(userText, userText, '  \n\t '))).toBeNull()
  })

  test('a selection that spans two source blocks gives null', () => {
    const { userText, resultText } = fixture()
    expect(selectionQuote(selectionOf(userText, resultText, 'one two'))).toBeNull()
  })

  test('a selection with one end outside every source block gives null', () => {
    const { userText, looseText } = fixture()
    expect(selectionQuote(selectionOf(userText, looseText, 'one two'))).toBeNull()
  })

  test('a selection inside a textarea gives null', () => {
    const { fieldText } = fixture()
    expect(selectionQuote(selectionOf(fieldText, fieldText, 'typed'))).toBeNull()
    const block = element('div', { 'data-quote-source': 'Your message' })
    const inputNode = textIn(element('input', {}, block))
    expect(selectionQuote(selectionOf(inputNode, inputNode, 'typed'))).toBeNull()
  })

  test('a selection inside a contenteditable element gives null', () => {
    const { editableText } = fixture()
    expect(selectionQuote(selectionOf(editableText, editableText, 'typed'))).toBeNull()
  })

  test('a selection inside a source block that sits in a textarea gives null', () => {
    const field = element('textarea', {})
    const block = element('div', { 'data-quote-source': 'Your message' }, field)
    expect(selectionQuote(selectionOf(textIn(block), textIn(block), 'x'))).toBeNull()
  })

  test('text over the limit is cut to the limit and ends with the shortened marker', () => {
    const { resultText } = fixture()
    const long = 'a'.repeat(QUOTE_MAX_CHARS + 10)
    const quote = selectionQuote(selectionOf(resultText, resultText, long))
    expect(quote).toEqual({ text: `${'a'.repeat(QUOTE_MAX_CHARS)}\n\n${QUOTE_SHORTENED_MARKER}`, source: 'Bash result' })
  })

  test('text exactly at the limit is not marked as shortened', () => {
    const { resultText } = fixture()
    const exact = 'b'.repeat(QUOTE_MAX_CHARS)
    expect(selectionQuote(selectionOf(resultText, resultText, exact))).toEqual({ text: exact, source: 'Bash result' })
  })

  test('the shortened marker shows up in the markdown', () => {
    const { resultText } = fixture()
    const quote = selectionQuote(selectionOf(resultText, resultText, 'c'.repeat(QUOTE_MAX_CHARS + 1)))
    expect(quoteMarkdown(quote?.text ?? '', 'why').endsWith(`> ${QUOTE_SHORTENED_MARKER}\n\nwhy`)).toBe(true)
  })
})

describe('buttonPosition', () => {
  const viewport = { width: 400, height: 300 }

  test('the button sits centred above the selection', () => {
    const rect = { top: 100, left: 150, width: 100, height: 20 }
    // Centred: 150 + 50 - 48 = 152. Above: 100 - 36 - 8 = 56.
    expect(buttonPosition(rect, viewport)).toEqual({ top: 56, left: 152 })
  })

  test('with no room above, the button goes below the selection', () => {
    const rect = { top: 20, left: 150, width: 100, height: 20 }
    expect(buttonPosition(rect, viewport)).toEqual({ top: 48, left: 152 })
  })

  test('the button is kept off the left and right edges', () => {
    const left = buttonPosition({ top: 100, left: -50, width: 10, height: 20 }, viewport)
    expect(left.left).toBe(8)
    const right = buttonPosition({ top: 100, left: 390, width: 10, height: 20 }, viewport)
    expect(right.left).toBe(400 - 96 - 8)
  })

  test('a selection taller than the viewport keeps the button inside the bottom edge', () => {
    const rect = { top: 10, left: 150, width: 100, height: 290 }
    expect(buttonPosition(rect, viewport).top).toBe(300 - 36 - 8)
  })

  test('a larger floating element uses its own size for the clamp', () => {
    const rect = { top: 100, left: 380, width: 10, height: 20 }
    expect(buttonPosition(rect, viewport, { width: 300, height: 200 }).left).toBe(400 - 300 - 8)
  })
})
