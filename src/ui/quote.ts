/**
 * Quotes: a span of chat text the user selects and comments on. These helpers are pure so they can be tested without a DOM. The
 * browser wiring lives in components/quote-comment.tsx.
 */

/** The attribute a source block declares its name with, e.g. data-quote-source="Bash result". */
export const QUOTE_SOURCE_ATTRIBUTE = 'data-quote-source'

/** The longest selected text a quote keeps. Anything past it is cut and marked as shortened. */
export const QUOTE_MAX_CHARS = 4000

/** The marker added after a shortened quote's text. */
export const QUOTE_SHORTENED_MARKER = '(shortened)'

const TEXT_NODE = 3

/** The part of a DOM node these helpers read. A DOM Node or Element satisfies it; tests use plain objects. */
export type Walkable = {
  nodeType?: number
  parentElement?: Walkable | null
  tagName?: string
  isContentEditable?: boolean
  getAttribute?(name: string): string | null
}

/** The part of a DOM Selection these helpers read. */
export type SelectionLike = {
  isCollapsed: boolean
  anchorNode: Walkable | null
  focusNode: Walkable | null
  toString(): string
}

export type SelectedQuote = { text: string; source: string }

export type Rect = { top: number; left: number; width: number; height: number }

export type Viewport = { width: number; height: number }

/** The size of a floating element, used to keep it inside the viewport. */
export type Size = { width: number; height: number }

/** The Comment button's size, and the gap kept from the selection and from the viewport edges. */
const BUTTON_SIZE: Size = { width: 96, height: 36 }
const FLOAT_GAP = 8
const VIEWPORT_MARGIN = 8

/** The element a node belongs to: a text node's parent, otherwise the node itself. */
function elementOf(node: Walkable): Walkable | null {
  if (node.nodeType === TEXT_NODE) {
    return node.parentElement ?? null
  }
  return node
}

/** The nearest element at or above `node` that declares a source name, or null when none does. */
function sourceBlockOf(node: Walkable): Walkable | null {
  let current: Walkable | null | undefined = elementOf(node)
  while (current !== null && current !== undefined) {
    const declared = current.getAttribute?.(QUOTE_SOURCE_ATTRIBUTE)
    if (declared !== null && declared !== undefined) {
      return current
    }
    current = current.parentElement
  }
  return null
}

/** Whether `node` is, or sits inside, a text field where a comment must not be started. */
function insideTextField(node: Walkable): boolean {
  let current: Walkable | null | undefined = elementOf(node)
  while (current !== null && current !== undefined) {
    const tag = current.tagName?.toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || current.isContentEditable === true) {
      return true
    }
    current = current.parentElement
  }
  return false
}

/**
 * The name a node's source block gives itself, from the nearest ancestor with data-quote-source. Null when the node is not inside a
 * source block or the name is empty.
 */
export function sourceOf(node: Walkable | null): string | null {
  if (node === null) {
    return null
  }
  const block = sourceBlockOf(node)
  const name = block?.getAttribute?.(QUOTE_SOURCE_ATTRIBUTE)?.trim() ?? ''
  return name === '' ? null : name
}

/**
 * The quoted text and its source for a selection, or null. Null when the selection is empty or collapsed, when its two ends are not
 * in the same source block (or either is outside every source block), or when it is inside an input, a textarea or an editable
 * element. Text longer than QUOTE_MAX_CHARS is cut and ends with QUOTE_SHORTENED_MARKER.
 */
export function selectionQuote(selection: SelectionLike | null): SelectedQuote | null {
  if (selection === null || selection.isCollapsed) {
    return null
  }
  const { anchorNode, focusNode } = selection
  if (anchorNode === null || focusNode === null) {
    return null
  }
  if (insideTextField(anchorNode) || insideTextField(focusNode)) {
    return null
  }
  const start = sourceBlockOf(anchorNode)
  const end = sourceBlockOf(focusNode)
  if (start === null || start !== end) {
    return null
  }
  const source = sourceOf(anchorNode)
  if (source === null) {
    return null
  }
  const trimmed = selection.toString().trim()
  if (trimmed === '') {
    return null
  }
  if (trimmed.length <= QUOTE_MAX_CHARS) {
    return { text: trimmed, source }
  }
  const cut = trimmed.slice(0, QUOTE_MAX_CHARS).trimEnd()
  return { text: `${cut}\n\n${QUOTE_SHORTENED_MARKER}`, source }
}

/** The bundle markdown for a quote: every line of the text as a blockquote line, a blank line, then the comment. */
export function quoteMarkdown(text: string, comment: string): string {
  const quoted = text
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join('\n')
  return `${quoted}\n\n${comment.trim()}`
}

/** The label a quote's composer card shows: "Quote · <source>". */
export function quoteTitle(source: string): string {
  return `Quote · ${source}`
}

/**
 * Where a floating element of `size` goes for a selection `rect`: centred above it, or below it when there is no room above. Its
 * position is clamped so it stays inside the viewport.
 */
export function buttonPosition(rect: Rect, viewport: Viewport, size: Size = BUTTON_SIZE): { top: number; left: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN)
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN)
  const centred = rect.left + rect.width / 2 - size.width / 2
  const left = Math.min(Math.max(centred, VIEWPORT_MARGIN), maxLeft)
  const above = rect.top - size.height - FLOAT_GAP
  const below = rect.top + rect.height + FLOAT_GAP
  const top = above >= VIEWPORT_MARGIN ? above : below
  return { top: Math.min(Math.max(top, VIEWPORT_MARGIN), maxTop), left }
}
