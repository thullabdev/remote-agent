import type { ReactNode } from 'react'
import type { ConnectionStatus } from '../use-web-channel.ts'
import { ConnectionNotice } from './ConnectionNotice.tsx'

type ChatViewProps = {
  /** The chat's header bar. */
  header: ReactNode
  status: ConnectionStatus
  onRetry(): void
  /** The feed or the dashboard. */
  children: ReactNode
  /** The composer under the feed. */
  composer: ReactNode
}

/** One chat in the main area: its header, the connection notice, the feed, and the composer. */
export function ChatView({ header, status, onRetry, children, composer }: ChatViewProps) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {header}
      <ConnectionNotice status={status} onRetry={onRetry} />
      <div className="chat-glow flex min-h-0 flex-1 flex-col">
        {children}
        {composer}
      </div>
    </section>
  )
}
