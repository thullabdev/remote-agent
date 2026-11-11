import { Check, FileText, Search, Upload } from 'lucide-react'
import type { UploadRecord } from '../../channel/web/protocol.ts'
import { formatSize, isPdf, shortName, uploadUrl } from '../uploads.ts'

export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf'

type UploadPickerProps = {
  uploads: UploadRecord[]
  /** The @ query being typed, or the search text when the picker was opened from the attach button. */
  query: string
  /** Set only when opened from the attach button: the picker then has its own search field. */
  search?: { value: string; onChange(value: string): void }
  selected: number
  /** A short notice, such as the 5-file limit or a refused file. */
  note: string | null
  /** The files attached to this message: each shows a check, and a tap on it detaches the file. */
  attachedIds: ReadonlySet<string>
  attachedCount: number
  limit: number
  onHover(index: number): void
  onPick(upload: UploadRecord): void
  onUploadFiles(files: File[]): void
  onManage(): void
  onDone(): void
}

/**
 * Lists library files above the composer. Picking a file attaches it; picking an attached file detaches it, so several can
 * be chosen without reopening. Deleting is not here: the library dialog does that.
 */
export function UploadPicker({ uploads, query, search, selected, note, attachedIds, attachedCount, limit, onHover, onPick, onUploadFiles, onManage, onDone }: UploadPickerProps) {
  return (
    <div
      id="chat-upload-picker"
      role="listbox"
      aria-label="Library files"
      aria-multiselectable="true"
      className="absolute bottom-full left-3 right-3 z-10 mx-auto mb-1 flex max-h-[min(60dvh,26rem)] max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl sm:left-6 sm:right-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pb-1 pt-2.5 text-xs text-muted-foreground">
        <span className="font-mono uppercase tracking-[.12em]">
          Library · {attachedCount} of {limit} attached
        </span>
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
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={onDone} className="rounded-full bg-muted px-3 py-1 font-medium text-foreground">
            Done
          </button>
        </div>
      </div>
      {search !== undefined && (
        <label className="mx-3 mb-1 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-1.5 text-sm">
          <Search className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search the library</span>
          <input
            type="search"
            value={search.value}
            onChange={event => search.onChange(event.target.value)}
            placeholder="Search by name"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
      )}
      {note !== null && <p className="px-3 pb-1 text-xs text-amber-800 dark:text-amber-300">{note}</p>}
      <div className="min-h-0 flex-1 overflow-auto pb-1">
        {uploads.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {query === '' ? 'The library is empty. Upload an image or PDF.' : `No library files match “${query}”.`}
          </p>
        ) : (
          uploads.map((upload, index) => {
            const attached = attachedIds.has(upload.id)
            return (
              <button
                key={upload.id}
                type="button"
                role="option"
                aria-selected={attached}
                title={upload.name}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(upload)}
                className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left ${index === selected ? 'bg-muted' : 'hover:bg-muted/70'}`}
              >
                <PickerThumb upload={upload} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{shortName(upload.name)}</span>
                  <span className="text-xs text-muted-foreground">{formatSize(upload.size)}</span>
                </span>
                {attached && (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground" aria-label="Attached">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function PickerThumb({ upload }: { upload: UploadRecord }) {
  if (isPdf(upload.mime)) {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted" aria-hidden="true">
        <FileText className="size-5" />
      </span>
    )
  }
  return (
    <img
      src={uploadUrl(upload.id, upload.hasThumbnail)}
      alt=""
      loading="lazy"
      className="size-12 shrink-0 rounded-lg bg-muted object-cover"
    />
  )
}
