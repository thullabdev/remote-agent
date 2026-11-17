import { describe, expect, test } from 'bun:test'
import type { FileChange } from '../backend/parse.ts'
import { buildTree, displayPath, flattenTree, pathsUnder, sumCounts, toggled } from './tree.ts'

function change(path: string, added: number | null, removed: number | null, binary = false): FileChange {
  return { path, oldPath: null, status: 'modified', added, removed, binary }
}

describe('buildTree', () => {
  test("folders sum their children's counts", () => {
    const tree = buildTree([change('a/x.ts', 2, 1), change('a/b/y.ts', 3, 0)])
    expect(tree).toHaveLength(1)
    const folder = tree[0]
    if (folder?.kind !== 'folder') {
      throw new Error('expected a folder')
    }
    expect(folder.name).toBe('a')
    expect(folder.added).toBe(5)
    expect(folder.removed).toBe(1)
  })

  test('files at the top level sit beside folders in name order, folders first', () => {
    const tree = buildTree([change('z.ts', 1, 0), change('src/x.ts', 1, 0), change('README.md', 1, 0)])
    expect(tree.map(node => node.name)).toEqual(['src', 'README.md', 'z.ts'])
    expect(tree.map(node => node.kind)).toEqual(['folder', 'file', 'file'])
  })

  test('a binary file counts as zero', () => {
    const tree = buildTree([change('img/logo.png', null, null, true), change('img/a.ts', 4, 2)])
    const folder = tree[0]
    if (folder?.kind !== 'folder') {
      throw new Error('expected a folder')
    }
    expect(folder.added).toBe(4)
    expect(folder.removed).toBe(2)
  })
})

describe('displayPath', () => {
  test('a file in a subfolder of the launch folder shows without ../', () => {
    expect(displayPath('src/feature/a.ts', '/repo', '/repo/src')).toBe('feature/a.ts')
    expect(displayPath('src/a.ts', '/repo', '/repo')).toBe('src/a.ts')
  })

  test('a file outside the launch folder shows with ../', () => {
    expect(displayPath('docs/guide.md', '/repo', '/repo/src')).toBe('../docs/guide.md')
    expect(displayPath('README.md', '/repo', '/repo/src/feature')).toBe('../../README.md')
  })
})

describe('sumCounts', () => {
  test('adds the counts of every file', () => {
    expect(sumCounts([change('a.ts', 2, 1), change('b/c.ts', 3, 4)])).toEqual({ added: 5, removed: 5 })
  })

  test('binary files and files without counts add zero', () => {
    expect(sumCounts([change('logo.png', 9, 9, true), change('x.ts', null, null)])).toEqual({ added: 0, removed: 0 })
  })

  test('an empty list is zero', () => {
    expect(sumCounts([])).toEqual({ added: 0, removed: 0 })
  })
})

describe('flattenTree', () => {
  test('lists folders before their children, indented by depth', () => {
    const rows = flattenTree(buildTree([change('src/a/x.ts', 1, 0), change('z.md', 1, 0)]), new Set())
    expect(rows.map((row) => `${row.kind}:${row.name}:${row.depth}`)).toEqual(['folder:src:0', 'folder:a:1', 'file:x.ts:2', 'file:z.md:0'])
  })

  test('a collapsed folder hides its children and keeps its own row', () => {
    const tree = buildTree([change('src/a/x.ts', 1, 0), change('src/y.ts', 1, 0)])
    const rows = flattenTree(tree, new Set(['folder:src']))
    expect(rows.map((row) => row.key)).toEqual(['folder:src'])
    const folder = rows[0]
    expect(folder?.kind === 'folder' && folder.open).toBe(false)
  })

  test('a key prefix keeps the keys of two trees apart', () => {
    const keys = flattenTree(buildTree([change('a.ts', 1, 0)]), new Set(), 'sha1/').map((row) => row.key)
    expect(keys).toEqual(['sha1/file:a.ts'])
  })

  test('folder totals sum the descendants', () => {
    const rows = flattenTree(buildTree([change('src/a.ts', 2, 1), change('src/b.ts', 3, 0)]), new Set())
    const folder = rows[0]
    expect(folder?.kind === 'folder' && folder.added).toBe(5)
  })
})

describe('toggled', () => {
  test('adds an absent key and removes a present one, without changing the input', () => {
    const before = new Set(['a'])
    expect([...toggled(before, 'b')].sort()).toEqual(['a', 'b'])
    expect([...toggled(before, 'a')]).toEqual([])
    expect([...before]).toEqual(['a'])
  })
})

describe('pathsUnder', () => {
  const files = [change('src/a.ts', 1, 0), change('src/feature/b.ts', 1, 0), change('srcx/c.ts', 1, 0), change('README.md', 1, 0)]

  test('returns only the files under the folder, including nested ones', () => {
    expect(pathsUnder(files, 'src')).toEqual(['src/a.ts', 'src/feature/b.ts'])
    expect(pathsUnder(files, 'src/feature')).toEqual(['src/feature/b.ts'])
  })

  test('does not match a sibling whose name only starts with the folder name', () => {
    expect(pathsUnder(files, 'src')).not.toContain('srcx/c.ts')
  })

  test('a folder path of empty string means every file', () => {
    expect(pathsUnder(files, '')).toEqual(['src/a.ts', 'src/feature/b.ts', 'srcx/c.ts', 'README.md'])
  })

  test('a file at the root is never under a folder', () => {
    expect(pathsUnder(files, 'README.md')).toEqual([])
  })

  test('an empty list has no paths', () => {
    expect(pathsUnder([], 'src')).toEqual([])
  })
})
