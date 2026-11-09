import { Folder, LoaderCircle, Rocket, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ApiClient, Project } from '../api.ts'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'

type NewSessionDialogProps = {
  open: boolean
  api: ApiClient
  onOpenChange(open: boolean): void
  onStarted(message: string): void
}

export function NewSessionDialog({ open, api, onOpenChange, onStarted }: NewSessionDialogProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState('')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    api.getProjects()
      .then(result => { if (active) setProjects(result.projects) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load trusted projects.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, open])

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (normalized === '') {
      return projects
    }
    return projects.filter(project => `${project.label} ${project.cwd}`.toLocaleLowerCase().includes(normalized))
  }, [projects, query])

  const start = async (project: Project) => {
    setStarting(true)
    setError(null)
    try {
      const result = await api.startProject({ cwd: project.cwd, ...(model.trim() === '' ? {} : { model: model.trim() }) })
      onStarted(result.toast)
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the Session.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Start a Session</DialogTitle>
          <DialogDescription>Choose a trusted project folder. The Bridge will start a new Spawned Session there.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-9" placeholder="Filter projects…" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <label className="grid gap-1.5 text-xs font-medium">
          Model <span className="font-normal text-muted-foreground">Optional; leave blank for the configured default.</span>
          <Input placeholder="e.g. claude-sonnet-4-5" value={model} onChange={event => setModel(event.target.value)} />
        </label>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading trusted projects…</div>
        ) : visibleProjects.length > 0 ? (
          <div className="max-h-[42dvh] space-y-2 overflow-y-auto">
            {visibleProjects.map(project => (
              <button
                type="button"
                key={`${project.cwd}-${project.label}`}
                disabled={starting}
                onClick={() => void start(project)}
                className="flex w-full items-center gap-3 rounded-2xl bg-background/70 p-3 text-left hover:border-primary/40 hover:bg-muted disabled:opacity-50"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><Folder className="size-4 text-muted-foreground" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{project.label}</span>
                  <code className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{project.cwd}</code>
                </span>
                {starting ? <LoaderCircle className="size-4 animate-spin" /> : <Rocket className="size-4 text-muted-foreground" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
            <Folder className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">{projects.length === 0 ? 'No trusted projects are configured' : 'No projects match that search'}</p>
            <p className="mt-1 text-xs text-muted-foreground">Open a folder in Claude Code and accept its trust dialog to add it here.</p>
          </div>
        )}
        {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
