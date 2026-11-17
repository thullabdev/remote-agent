import { describe, expect, test } from 'bun:test'
import type { FileChange } from '../backend/parse.ts'
import { buildTree } from './tree.ts'

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
