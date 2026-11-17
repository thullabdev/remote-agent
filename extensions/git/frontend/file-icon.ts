/** The kind of icon a file shows, chosen from its extension. */
export type IconKey = 'code' | 'json' | 'text' | 'image' | 'config' | 'file'

const KEY_BY_EXTENSION = new Map<string, IconKey>([
  ...['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'css', 'html', 'py', 'go', 'rs', 'java', 'sh'].map((ext): [string, IconKey] => [ext, 'code']),
  ['json', 'json'],
  ...['md', 'txt', 'rst'].map((ext): [string, IconKey] => [ext, 'text']),
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].map((ext): [string, IconKey] => [ext, 'image']),
  ...['yml', 'yaml', 'toml', 'ini', 'env', 'lock'].map((ext): [string, IconKey] => [ext, 'config']),
])

/** The icon key for a path, from the extension of its file name (case-insensitive). A name without an extension is 'file'. */
export function iconKeyFor(path: string): IconKey {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot < 0) {
    return 'file'
  }
  return KEY_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? 'file'
}
