import type { FileChange } from '../backend/parse.ts'

export type TreeNode =
  | { name: string; path: string; kind: 'folder'; added: number; removed: number; children: TreeNode[] }
  | { name: string; path: string; kind: 'file'; file: FileChange }

type FolderNode = Extract<TreeNode, { kind: 'folder' }>

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'folder' ? -1 : 1
  }
  return a.name.localeCompare(b.name)
}

function sortRecursively(nodes: TreeNode[]): void {
  nodes.sort(compareNodes)
  for (const node of nodes) {
    if (node.kind === 'folder') {
      sortRecursively(node.children)
    }
  }
}

/** Groups changed files into folders by path segment. Folder counts sum their descendants; binary files count as zero. */
export function buildTree(files: FileChange[]): TreeNode[] {
  const top: TreeNode[] = []
  const folders = new Map<string, FolderNode>()

  for (const file of files) {
    const segments = file.path.split('/')
    const fileName = segments.pop() ?? file.path
    const added = file.binary ? 0 : (file.added ?? 0)
    const removed = file.binary ? 0 : (file.removed ?? 0)

    let siblings = top
    let prefix = ''
    for (const segment of segments) {
      prefix = prefix === '' ? segment : `${prefix}/${segment}`
      let folder = folders.get(prefix)
      if (folder === undefined) {
        folder = { name: segment, path: prefix, kind: 'folder', added: 0, removed: 0, children: [] }
        folders.set(prefix, folder)
        siblings.push(folder)
      }
      folder.added += added
      folder.removed += removed
      siblings = folder.children
    }

    siblings.push({ name: fileName, path: file.path, kind: 'file', file })
  }

  sortRecursively(top)
  return top
}
