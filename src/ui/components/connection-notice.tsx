import type { ConnectionStatus } from '../use-web-channel.ts'
import { connectionNoticeText } from '../presentation.ts'

type ConnectionNoticeProps = {
  status: ConnectionStatus
  /** Tries the connection again now. The Retry button shows only when this is given, and only while reconnecting or failed. */
  onRetry?(): void
  /** `card` sits inside the session list; `bar` runs across the top of a chat. */
  variant?: 'card' | 'bar'
}

/** Says what is wrong with the connection, and offers to try again. Shows nothing while all is well. */
export function ConnectionNotice({ status, onRetry, variant = 'bar' }: ConnectionNoticeProps) {
  const text = connectionNoticeText(status)
  if (text === undefined) {
    return null
  }
  const showRetry = onRetry !== undefined && (status === 'reconnecting' || status === 'error')
  const dot = <span className={`size-2 shrink-0 rounded-full ${status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
  if (variant === 'card') {
    return (
      <div role="status" className="mx-4 mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
        {dot}
        <span className="min-w-0 flex-1">{text}</span>
        {showRetry && (
          <button type="button" onClick={onRetry} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/60">
            Retry
          </button>
        )}
      </div>
    )
  }
  return (
    <div role="status" className="flex shrink-0 items-center justify-center gap-3 border-b border-border/60 bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
      {dot}
      {text}
      {showRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-full px-3 py-1 font-medium text-foreground hover:bg-background/60">
          Retry
        </button>
      )}
    </div>
  )
}
