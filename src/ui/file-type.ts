/** The icon a file shows when it has no image preview. Each key maps to one lucide icon in components/file-icon.tsx. */
export type FileIconKey = 'image' | 'document' | 'web' | 'table' | 'json' | 'code' | 'file'

const KEY_BY_EXTENSION: ReadonlyMap<string, FileIconKey> = new Map<string, FileIconKey>([
  ['png', 'image'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['gif', 'image'],
  ['webp', 'image'],
  ['pdf', 'document'],
  ['md', 'document'],
  ['markdown', 'document'],
  ['txt', 'document'],
  ['log', 'document'],
  ['html', 'web'],
  ['htm', 'web'],
  ['csv', 'table'],
  ['tsv', 'table'],
  ['json', 'json'],
  ['yaml', 'code'],
  ['yml', 'code'],
  ['xml', 'code'],
])

/**
 * The icon key for a file. The mime decides images and PDFs; otherwise the extension of the name does, ignoring case.
 * A name without a known extension is 'file'.
 */
export function fileIconKey(name: string, mime: string): FileIconKey {
  if (mime.startsWith('image/')) {
    return 'image'
  }
  if (mime === 'application/pdf') {
    return 'document'
  }
  const dot = name.lastIndexOf('.')
  if (dot < 0) {
    return 'file'
  }
  return KEY_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? 'file'
}
