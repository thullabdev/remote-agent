import type { ConnectionStatus } from '../use-web-channel.ts'
import { connectionNoticeText } from '../presentation.ts'

/** A bar under the chat header while the connection is down or being restored. Shows nothing when all is well. */
export function ConnectionNotice({ status, onRetry }: { status: ConnectionStatus; onRetry(): void }) {
  const text = connectionNoticeText(status)
  if (text === undefined) {
    return null
  }
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-b border-border/60 bg-muted px-3 py-2 text-center text-xs text-muted-foreground" role="status">
      <span className={`size-2 shrink-0 rounded-full ${status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
      {text}
      {(status === 'reconnecting' || status === 'error') && (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-full px-3 py-1 font-medium text-foreground hover:bg-background/60">
          Retry
        </button>
      )}
    </div>
  )
}
