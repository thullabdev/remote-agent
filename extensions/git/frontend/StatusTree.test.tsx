import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileChange } from '../backend/parse.ts'
import { SectionTotals, StatusTree, TreeFileRow } from './StatusTree.tsx'

function file(path: string, added: number | null, removed: number | null, binary = false): FileChange {
  return { path, oldPath: null, status: 'modified', added, removed, binary }
}

describe('SectionTotals', () => {
  test('shows the sum of the section as +added −removed', () => {
    const markup = renderToStaticMarkup(<SectionTotals files={[file('a.ts', 2, 1), file('b.ts', 3, 4)]} />)
    expect(markup).toContain('+5')
    expect(markup).toContain('−5')
    expect(markup).toContain('text-emerald-600')
    expect(markup).toContain('text-red-600')
  })

  test('mutes a zero part and leaves binary files out of the sum', () => {
    const markup = renderToStaticMarkup(<SectionTotals files={[file('logo.png', null, null, true), file('a.ts', 0, 0)]} />)
    expect(markup).toContain('+0')
    expect(markup).toContain('−0')
    expect(markup.match(/text-muted-foreground/g)?.length).toBe(2)
  })
})

describe('TreeFileRow', () => {
  test('the name is small and the row has a fixed height class', () => {
    const markup = renderToStaticMarkup(<TreeFileRow file={file('src/a.ts', 1, 0)} name="a.ts" depth={1} onOpen={() => {}} />)
    expect(markup).toContain('text-xs')
    expect(markup).toContain('h-full')
    expect(markup).toContain('padding-left:12px')
    expect(markup).toContain('a.ts')
  })
})

describe('StatusTree folder actions', () => {
  const files = [file('src/a.ts', 1, 0), file('src/feature/b.ts', 1, 0), file('README.md', 1, 0)]

  test('the Changes tree gives every folder a Stage folder button, and keeps the file buttons', () => {
    const markup = renderToStaticMarkup(
      <StatusTree files={files} mode="unstaged" onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('aria-label="Stage src/"')
    expect(markup).toContain('aria-label="Stage src/feature/"')
    expect(markup).not.toContain('aria-label="Unstage ')
    expect(markup).toContain('aria-label="Stage src/a.ts"')
  })

  test('the Staged tree gives every folder an Unstage folder button, and keeps the file buttons', () => {
    const markup = renderToStaticMarkup(
      <StatusTree files={files} mode="staged" onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('aria-label="Unstage src/"')
    expect(markup).toContain('aria-label="Unstage src/feature/"')
    expect(markup).not.toContain('aria-label="Stage ')
    expect(markup).toContain('aria-label="Unstage src/a.ts"')
  })
})

describe('StatusTree folder collapse', () => {
  function many(count: number): FileChange[] {
    return Array.from({ length: count }, (_, index) => file(`src/a${index}.ts`, 1, 0))
  }

  test('a tree of more than 20 files starts with its folders collapsed', () => {
    const markup = renderToStaticMarkup(
      <StatusTree files={many(21)} mode="unstaged" onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('aria-label="Stage src/a0.ts"')
  })

  test('a tree of 20 files or fewer starts expanded', () => {
    const markup = renderToStaticMarkup(
      <StatusTree files={many(2)} mode="unstaged" onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-label="Stage src/a0.ts"')
  })

  test('a folder row labels its toggle with aria-expanded and keeps the folder action labelled with its path', () => {
    const markup = renderToStaticMarkup(
      <StatusTree files={many(2)} mode="staged" onOpen={() => {}} onStage={() => {}} onUnstage={() => {}} />,
    )
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-label="Unstage src/"')
  })
})
