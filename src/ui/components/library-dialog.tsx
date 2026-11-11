import { FileText, Search, Trash2, Upload } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import type { UploadRecord, UploadRef } from '../../channel/web/protocol.ts'
import { filterUploads, formatSize, isPdf, MAX_UPLOAD_BYTES, uploadUrl } from '../uploads.ts'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { UPLOAD_ACCEPT } from './upload-picker.tsx'

type LibraryDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
  library: UploadRecord[]
  /** Uploads one file to the library. The library list updates itself; the composer does not attach it. */
  onUpload(file: File): Promise<UploadRef | null>
  onDelete(upload: UploadRecord): void
}

/** The library: every uploaded file, what it is, and how many messages use it. Files can be added here or removed. */
export function LibraryDialog({ open, onOpenChange, library, onUpload, onDelete }: LibraryDialogProps) {
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const shown = filterUploads(library, query)
  const totalBytes = library.reduce((sum, upload) => sum + upload.size, 0)

  const uploadFiles = async (files: File[]) => {
    setNote(null)
    const accepted = files.filter(file => {
      if (file.size > MAX_UPLOAD_BYTES) {
        setNote(`${file.name} is larger than 10 MB and was skipped.`)
        return false
      }
      return true
    })
    if (accepted.length === 0) {
      return
    }
    for (const [index, file] of accepted.entries()) {
      setUploading({ done: index, total: accepted.length })
      await onUpload(file)
    }
    setUploading(null)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,44rem)] max-h-[min(88dvh,50rem)]">
        <DialogHeader>
          <DialogTitle>Library</DialogTitle>
          <DialogDescription>
            {library.length === 0 ? 'Nothing uploaded yet.' : `${library.length} ${library.length === 1 ? 'file' : 'files'} · ${formatSize(totalBytes)}. Attach them in any Session by typing @ or the attach button.`}
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={event => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-3 text-sm transition-colors ${dragging ? 'border-foreground/50 bg-muted' : 'border-border'}`}
        >
          <span className="text-muted-foreground">
            {uploading !== null ? `Uploading ${uploading.done + 1} of ${uploading.total}…` : 'Drop images or PDFs here'}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 font-medium hover:bg-muted/70">
            <Upload className="size-3.5" aria-hidden="true" />
            Choose files
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="sr-only"
              disabled={uploading !== null}
              onChange={event => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void uploadFiles(files)
              }}
            />
          </label>
        </div>
        {note !== null && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">{note}</p>}

        <label className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search the library</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search by name"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {library.length === 0 ? 'Files you upload appear here.' : `No files match “${query}”.`}
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {shown.map(upload => (
              <li key={upload.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60">
                <LibraryThumb upload={upload} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{upload.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(upload.size)} · {formatDate(upload.createdAt)} · {describeUses(upload.uses ?? 0)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${upload.name} from the library`}
                  title="Delete from the library"
                  onClick={() => onDelete(upload)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LibraryThumb({ upload }: { upload: UploadRecord }) {
  if (isPdf(upload.mime)) {
    return (
      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted" aria-hidden="true">
        <FileText className="size-5" />
      </span>
    )
  }
  return <img src={uploadUrl(upload.id, upload.hasThumbnail)} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg bg-muted object-cover" />
}

/** What the library says about a file's use, in words a person can act on. */
export function describeUses(uses: number): string {
  if (uses === 0) {
    return 'Not used yet'
  }
  return uses === 1 ? 'Used in 1 message' : `Used in ${uses} messages`
}

function formatDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
