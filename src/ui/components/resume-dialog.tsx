import { useEffect, useState } from 'react'
import type { ApiClient } from '../api.ts'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.tsx'

export type ResumeChoice = { value: string | null; label: string; detail: string }

const MODEL_CHOICES: ResumeChoice[] = [
  { value: 'opus', label: 'Opus', detail: 'Most capable' },
  { value: 'sonnet', label: 'Sonnet', detail: 'Balanced for everyday work' },
  { value: 'haiku', label: 'Haiku', detail: 'Fastest and lightest' },
  { value: 'opusplan', label: 'Opus plan', detail: 'Opus to plan, then Sonnet to carry it out' },
]

/**
 * The choices for resuming. The model the Session last ran on comes first and is the default; otherwise Claude's own default is.
 * `previous` is undefined while it loads, and then no choice can be made yet.
 */
export function resumeChoices(previous: string | null | undefined): ResumeChoice[] {
  const sameAsBefore: ResumeChoice[] = previous === null || previous === undefined ? [] : [{ value: previous, label: 'Same as before', detail: previous }]
  return [...sameAsBefore, { value: null, label: 'Claude default', detail: 'The model Claude Code uses when none is chosen' }, ...MODEL_CHOICES]
}

/** The choice selected when the dialog opens: the model the Session last ran on, else Claude's default. */
export function defaultResumeChoice(previous: string | null | undefined): string | null {
  return previous ?? null
}

type ResumeDialogProps = {
  open: boolean
  api: ApiClient
  chatId: string
  onOpenChange(open: boolean): void
  /** Receives the chosen model: null resumes on the model the Session last used, or on Claude's default when it is unknown. */
  onResume(model: string | null): void
}

export function ResumeDialog({ open, api, chatId, onOpenChange, onResume }: ResumeDialogProps) {
  const [previous, setPrevious] = useState<string | null | undefined>(undefined)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    setPrevious(undefined)
    api.resumeModel(chatId).then(
      result => {
        if (active) {
          setPrevious(result.model)
          setSelected(defaultResumeChoice(result.model))
        }
      },
      () => {
        if (active) {
          setPrevious(null)
          setSelected(null)
        }
      },
    )
    return () => {
      active = false
    }
  }, [api, chatId, open])

  const choices = resumeChoices(previous)
  const loading = previous === undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resume session</DialogTitle>
          <DialogDescription>Pick the model it continues on. The conversation and its history stay as they are.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Model" className="grid gap-1.5">
          {loading && <p className="py-3 text-sm text-muted-foreground">Looking up the model it last used…</p>}
          {!loading &&
            choices.map(choice => (
              <button
                key={choice.label}
                type="button"
                role="radio"
                aria-checked={selected === choice.value}
                onClick={() => setSelected(choice.value)}
                className={`flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${selected === choice.value ? 'border-primary/60 bg-muted' : 'border-border/60 hover:bg-muted/60'}`}
              >
                <span
                  className={`size-3.5 shrink-0 rounded-full border ${selected === choice.value ? 'border-primary bg-primary' : 'border-muted-foreground/60'}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{choice.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{choice.detail}</span>
                </span>
              </button>
            ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={loading} onClick={() => { onOpenChange(false); onResume(selected) }}>
            Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
