import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { VirtualRows } from './VirtualRows.tsx'

function rowsOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `row-${index}`)
}

describe('VirtualRows', () => {
  test('renders only a window of 1000 rows, not all of them', () => {
    const markup = renderToStaticMarkup(
      <VirtualRows rows={rowsOf(1000)} rowHeight={28} getKey={(row) => row} renderRow={(row) => <span>{row}</span>} />,
    )
    const rendered = markup.match(/role="listitem"/g)?.length ?? 0
    expect(rendered).toBeGreaterThanOrEqual(10)
    expect(rendered).toBeLessThanOrEqual(20)
    expect(markup).toContain('row-0<')
    expect(markup).not.toContain('row-999<')
  })

  test('the spacer takes the full height of all rows', () => {
    const markup = renderToStaticMarkup(
      <VirtualRows rows={rowsOf(1000)} rowHeight={28} getKey={(row) => row} renderRow={(row) => <span>{row}</span>} />,
    )
    expect(markup).toContain('height:28000px')
  })

  test('variable row heights place rows by their offsets', () => {
    const markup = renderToStaticMarkup(
      <VirtualRows
        rows={['commit', 'file']}
        rowHeight={(row) => (row === 'commit' ? 40 : 28)}
        getKey={(row) => row}
        renderRow={(row) => <span>{row}</span>}
      />,
    )
    expect(markup).toContain('top:0px;height:40px')
    expect(markup).toContain('top:40px;height:28px')
    expect(markup).toContain('height:68px')
  })

  test('an empty list renders no rows', () => {
    const markup = renderToStaticMarkup(<VirtualRows rows={[]} rowHeight={28} getKey={(row: string) => row} renderRow={(row) => <span>{row}</span>} />)
    expect(markup).not.toContain('role="listitem"')
  })
})
