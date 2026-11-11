import { CircleAlert, CircleCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export type ToastKind = 'success' | 'error'

export type ToastState = { id: number; message: string; kind: ToastKind }

/** Errors stay longer: the user has to read what went wrong and act on it. */
export function toastDuration(kind: ToastKind): number {
  return kind === 'error' ? 7000 : 4000
}

type ToastProps = {
  toast: ToastState
  onDismiss(): void
}

/**
 * A quiet card in the app's own look: a tinted icon says whether it worked, the ring and shadow lift it off the page,
 * and on a phone it sits at the top inside the safe area (the bottom holds the composer and the keyboard).
 * It is held while a finger or pointer is on it.
 */
export function Toast({ toast, onDismiss }: ToastProps) {
  const [held, setHeld] = useState(false)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const error = toast.kind === 'error'

  useEffect(() => {
    if (held) {
      return
    }
    const timer = setTimeout(() => dismiss.current(), toastDuration(toast.kind))
    return () => clearTimeout(timer)
  }, [toast.id, toast.kind, held])

  return (
    <div
      data-kind={toast.kind}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
      onPointerDown={() => setHeld(true)}
      onPointerUp={() => setHeld(false)}
      onPointerCancel={() => setHeld(false)}
      onPointerEnter={event => event.pointerType === 'mouse' && setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      className={`toast-in fixed inset-x-4 top-[max(.75rem,env(safe-area-inset-top))] z-[70] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-card py-2.5 pl-2.5 pr-1.5 text-sm leading-snug shadow-lg ring-1 backdrop-blur md:inset-x-auto md:bottom-6 md:left-1/2 md:top-auto md:-translate-x-1/2 ${
        error ? 'ring-red-500/40' : 'ring-border'
      }`}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-full ${
          error ? 'bg-red-500/15 text-red-600 dark:text-red-400' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        }`}
      >
        {error ? <CircleAlert className="size-[18px]" aria-hidden="true" /> : <CircleCheck className="size-[18px]" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1 break-words text-foreground">{toast.message}</span>
      <button
        type="button"
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
