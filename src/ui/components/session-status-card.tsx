import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import type { Message } from '../../channel/web/protocol.ts'
import { formatTime } from '../presentation.ts'

type StatusMessage = Extract<Message, { kind: 'session_status' }>

const HEADLINE = {
  starting: 'Starting the session…',
  resuming: 'Resuming the session…',
  ready: 'Ready. Send your first task below.',
} as const

/** A Spawned Session's startup as one card: a spinner while it starts, then a check, or what went wrong. */
export function SessionStatusCard({ message }: { message: StatusMessage }) {
  const failed = message.state === 'failed'
  const ready = message.state === 'ready'
  return (
    <div className="flex justify-center py-1">
      <div
        data-state={message.state}
        role={failed ? 'alert' : 'status'}
        className={`w-full max-w-sm rounded-2xl border bg-card px-4 py-3 text-sm shadow-sm ${failed ? 'border-red-500/40' : 'border-border/70'}`}
      >
        <div className="flex items-center gap-2.5">
          {failed ? (
            <CircleAlert className="size-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          ) : ready ? (
            <CircleCheck className="size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
          )}
          <p className="min-w-0 flex-1 font-medium">{message.state === 'failed' ? (message.message ?? 'The session could not start') : HEADLINE[message.state]}</p>
          <time className="shrink-0 font-mono text-[10px] text-muted-foreground" dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
        </div>
        <p className="mt-1.5 break-all pl-[1.875rem] font-mono text-[11px] leading-snug text-muted-foreground">{message.cwd}</p>
        {failed && message.detail !== null && message.detail !== '' && (
          <details className="mt-2 pl-[1.875rem]">
            <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2 font-mono text-[11px]">{message.detail}</pre>
          </details>
        )}
        {failed && <p className="mt-2 pl-[1.875rem] text-xs text-muted-foreground">Start a new session from the list, or resume this one from its details.</p>}
      </div>
    </div>
  )
}
