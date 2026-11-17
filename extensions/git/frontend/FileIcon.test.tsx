import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileIcon } from './FileIcon.tsx'

describe('FileIcon', () => {
  test('draws a different icon for code and for plain files', () => {
    const code = renderToStaticMarkup(<FileIcon path="src/a.ts" />)
    const plain = renderToStaticMarkup(<FileIcon path="LICENSE" />)
    expect(code).toContain('<svg')
    expect(plain).toContain('<svg')
    expect(code).not.toBe(plain)
  })
})
