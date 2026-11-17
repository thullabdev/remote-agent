import { Folder, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createApiClient, type Project } from '../../../src/ui/api.ts'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../src/ui/components/ui/dialog.tsx'

/**
 * Asks which trusted project folder a new terminal starts in. Used when there is no active chat folder to start in.
 * The projects are the same trusted folders the new-session dialog lists.
 */
export function FolderPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange(open: boolean): void; onPick(cwd: string): void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    setProjects(null)
    setError(null)
    createApiClient()
      .getProjects()
      .then(result => {
        if (active) {
          setProjects(result.projects)
        }
      })
      .catch(reason => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Could not load trusted projects.')
        }
      })
    return () => {
      active = false
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a terminal in…</DialogTitle>
          <DialogDescription>Choose a trusted project folder. The shell opens there, on your computer.</DialogDescription>
        </DialogHeader>
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : projects === null ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading trusted projects…
          </div>
        ) : projects.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No trusted projects are configured.</p>
        ) : (
          <ul className="grid max-h-80 gap-1 overflow-y-auto">
            {projects.map(project => (
              <li key={project.cwd}>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 rounded-2xl px-3 py-2 text-left"
                  title={project.cwd}
                  onClick={() => {
                    onPick(project.cwd)
                    onOpenChange(false)
                  }}
                >
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{project.cwd}</span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
