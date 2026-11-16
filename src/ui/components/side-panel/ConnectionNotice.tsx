import type { ConnectionStatus } from '../../use-web-channel.ts'
import { connectionNoticeText } from '../../presentation.ts'

/** Says nothing while all is well. A line that is always on becomes invisible, so it only shows when the connection is not fine. */
export function ConnectionNotice({ status, onRetry }: { status: ConnectionStatus; onRetry?: () => void }) {
  const text = connectionNoticeText(status)
  if (text === undefined) {
    return null
  }
  return (
    <div role="status" className="mx-4 mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span className={`size-2 shrink-0 rounded-full ${status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">{text}</span>
      {onRetry !== undefined && (status === 'reconnecting' || status === 'error') && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background/60">
          Retry
        </button>
      )}
    </div>
  )
}
