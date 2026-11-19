import { File as FileIcon, FileCode, FileImage, FileJson, FileSpreadsheet, FileText, type LucideIcon } from 'lucide-react'
import { fileIconKey, type FileIconKey } from '../file-type.ts'

const ICON_BY_KEY: Record<FileIconKey, LucideIcon> = {
  image: FileImage,
  document: FileText,
  web: FileCode,
  table: FileSpreadsheet,
  json: FileJson,
  code: FileCode,
  file: FileIcon,
}

/** A small icon for a file, picked from its name and mime. */
export function FileTypeIcon({ name, mime, className }: { name: string; mime: string; className?: string }) {
  const Icon = ICON_BY_KEY[fileIconKey(name, mime)]
  return <Icon className={className} aria-hidden="true" />
}

/** The square tile that stands in for a preview in library and picker rows: the file's icon on a muted square. */
export function FileTile({ name, mime }: { name: string; mime: string }) {
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
      <FileTypeIcon name={name} mime={mime} className="size-4" />
    </span>
  )
}
