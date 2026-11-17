import { File, FileCode, FileCog, FileImage, FileJson, FileText, type LucideIcon } from 'lucide-react'
import { cn } from '../../../src/ui/lib/utils.ts'
import { type IconKey, iconKeyFor } from './file-icon.ts'

const ICON_BY_KEY: Record<IconKey, LucideIcon> = {
  code: FileCode,
  json: FileJson,
  text: FileText,
  image: FileImage,
  config: FileCog,
  file: File,
}

/** The icon for a file, chosen from its extension. */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const Icon = ICON_BY_KEY[iconKeyFor(path)]
  return <Icon className={cn('shrink-0', className)} aria-hidden="true" />
}
