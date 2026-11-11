import { FileText, Trash2, Upload } from 'lucide-react'
import type { UploadRecord } from '../../channel/web/protocol.ts'
import { formatSize, isPdf, uploadUrl } from '../uploads.ts'

export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf'

type UploadPickerProps = {
  uploads: UploadRecord[]
  query: string
  selected: number
  /** A short notice, such as the 5-file limit or a refused file. */
  note: string | null
  onHover(index: number): void
  onPick(upload: UploadRecord): void
  onDelete(upload: UploadRecord): void
  onUploadFiles(files: File[]): void
  onManage(): void
}

/** Lists library files above the composer. Images show their preview; PDFs show a PDF icon. */
export function UploadPicker({ uploads, query, selected, note, onHover, onPick, onDelete, onUploadFiles, onManage }: UploadPickerProps) {
  return (
    <div
      id="chat-upload-picker"
      role="listbox"
      aria-label="Library files"
      className="absolute bottom-full left-3 right-3 z-10 mx-auto mb-1 max-h-80 max-w-4xl overflow-auto rounded-2xl bg-card py-1 shadow-xl sm:left-6 sm:right-6"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-mono uppercase tracking-[.12em]">Library</span>
        <div className="flex items-center gap-3">
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={onManage} className="font-medium text-foreground hover:underline">
            Manage
          </button>
          <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-foreground">
            <Upload className="size-3.5" aria-hidden="true" />
            Upload new…
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="sr-only"
              onChange={event => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (files.length > 0) {
                  onUploadFiles(files)
                }
              }}
            />
          </label>
        </div>
      </div>
      {note !== null && <p className="px-3 pb-1 text-xs text-amber-800 dark:text-amber-300">{note}</p>}
      {uploads.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">
          {query === '' ? 'The library is empty. Upload an image or PDF.' : `No library files match “${query}”.`}
        </p>
      ) : (
        uploads.map((upload, index) => (
          <div
            key={upload.id}
            role="option"
            aria-selected={index === selected}
            onMouseEnter={() => onHover(index)}
            className={`flex items-center gap-2 px-3 py-2 ${index === selected ? 'bg-muted' : 'hover:bg-muted/70'}`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onMouseDown={event => event.preventDefault()}
              onClick={() => onPick(upload)}
            >
              <PickerThumb upload={upload} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{upload.name}</span>
                <span className="text-xs text-muted-foreground">{formatSize(upload.size)}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Delete ${upload.name} from the library`}
              title="Delete from the library"
              onClick={() => onDelete(upload)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </div>
        ))
      )}
    </div>
  )
}

function PickerThumb({ upload }: { upload: UploadRecord }) {
  if (isPdf(upload.mime)) {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted" aria-hidden="true">
        <FileText className="size-5" />
      </span>
    )
  }
  return (
    <img
      src={uploadUrl(upload.id, upload.hasThumbnail)}
      alt=""
      loading="lazy"
      className="size-10 shrink-0 rounded-lg bg-muted object-cover"
    />
  )
}
