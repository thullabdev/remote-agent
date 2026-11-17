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

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '')
}

/**
 * The path of a repo-relative file as seen from the launch folder: relative to it, with `../` segments for a file outside it.
 */
export function displayPath(filePath: string, repoRoot: string, launchCwd: string): string {
  const from = segmentsOf(launchCwd)
  const to = [...segmentsOf(repoRoot), ...segmentsOf(filePath)]
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) {
    shared += 1
  }
  const ups = from.slice(shared).map(() => '..')
  return [...ups, ...to.slice(shared)].join('/')
}

/**
 * The paths of the files under a folder, for a folder-level stage or unstage. A folder path of '' means the whole repository.
 * A file is under a folder only when its path starts with the folder path followed by '/'.
 */
export function pathsUnder(files: FileChange[], folderPath: string): string[] {
  const paths: string[] = []
  for (const file of files) {
    if (folderPath === '' || file.path.startsWith(`${folderPath}/`)) {
      paths.push(file.path)
    }
  }
  return paths
}

/** The total added and removed lines of a list of files. Binary files and files without counts add zero. */
export function sumCounts(files: FileChange[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const file of files) {
    if (!file.binary) {
      added += file.added ?? 0
      removed += file.removed ?? 0
    }
  }
  return { added, removed }
}

/** A row of the tree as it is drawn: folders and files in order, indented by depth. */
export type VisibleTreeRow =
  | { kind: 'folder'; key: string; name: string; path: string; depth: number; open: boolean; added: number; removed: number }
  | { kind: 'file'; key: string; name: string; path: string; depth: number; file: FileChange }

/**
 * Flattens the tree into the rows shown in a list. A folder whose key is in `collapsed` hides its children.
 * `keyPrefix` keeps keys unique when several trees share one list.
 */
export function visibleRows(nodes: TreeNode[], collapsed: ReadonlySet<string>, keyPrefix = '', depth = 0): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = []
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const key = `${keyPrefix}folder:${node.path}`
      const open = !collapsed.has(key)
      rows.push({ kind: 'folder', key, name: node.name, path: node.path, depth, open, added: node.added, removed: node.removed })
      if (open) {
        rows.push(...visibleRows(node.children, collapsed, keyPrefix, depth + 1))
      }
    } else {
      rows.push({ kind: 'file', key: `${keyPrefix}file:${node.path}`, name: node.name, path: node.path, depth, file: node.file })
    }
  }
  return rows
}

/** Trees with more files than this start with every folder collapsed. */
export const AUTO_COLLAPSE_FILE_COUNT = 20

/** Whether a tree of `fileCount` files starts with its folders collapsed. */
export function startsCollapsed(fileCount: number): boolean {
  return fileCount > AUTO_COLLAPSE_FILE_COUNT
}

/** The key of every folder in the tree, in the form `visibleRows` uses with no key prefix. */
export function folderKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = []
  for (const node of nodes) {
    if (node.kind === 'folder') {
      keys.push(`folder:${node.path}`, ...folderKeys(node.children))
    }
  }
  return keys
}

/**
 * The folders that are collapsed now. A folder starts collapsed when `collapsedByDefault` is true; a folder whose key is in
 * `toggledKeys` has been flipped by the person from that default.
 */
export function collapsedFolders(nodes: TreeNode[], collapsedByDefault: boolean, toggledKeys: ReadonlySet<string>): Set<string> {
  const collapsed = new Set<string>()
  for (const key of folderKeys(nodes)) {
    if (collapsedByDefault !== toggledKeys.has(key)) {
      collapsed.add(key)
    }
  }
  return collapsed
}

/** A copy of a key set with `key` added when absent, and removed when present. */
export function toggled(keys: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(keys)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  return next
}
