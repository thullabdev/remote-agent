import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { TranscriptItem } from '../../../channel/web/transcript/parse.ts'
import { subagentMessages } from '../../subagent-messages.ts'
import { MessageRows } from '../message-feed.tsx'
import { Button } from '../ui/button.tsx'
import type { SubagentApi } from './types.ts'

/**
 * A sub-agent's activity, one page at a time, drawn with the chat's own rows, collapsed like the chat. Pages load when the panel opens on it,
 * on "Load more", and on "Refresh" at the bottom, which reads the activity again from the first line.
 */
export function SubagentActivity({
  api,
  chatId,
  agentId,
  onOpenSubagent,
}: {
  api: SubagentApi
  chatId: string
  agentId: string
  onOpenSubagent?(agentId: string, title: string): void
}) {
  const [view, setView] = useState<{ items: TranscriptItem[]; next: number | null; phase: 'loading' | 'ready' | 'failed' }>({ items: [], next: 0, phase: 'loading' })
  const [busy, setBusy] = useState<'more' | 'refresh' | null>(null)
  const generation = useRef(0)

  // Reads from `cursor`. A page from the first line replaces what is shown; a later page is added to it.
  const read = (cursor: number, kind: 'more' | 'refresh' | 'first') => {
    const token = generation.current + 1
    generation.current = token
    if (kind !== 'more') {
      setView(current => (kind === 'first' ? { items: [], next: 0, phase: 'loading' } : current))
    }
    setBusy(kind === 'first' ? null : kind)
    api
      .subagentActivity(chatId, agentId, cursor)
      .then(page => {
        if (token !== generation.current) {
          return
        }
        setView(current => ({ items: cursor === 0 ? page.items : [...current.items, ...page.items], next: page.nextCursor, phase: 'ready' }))
      })
      .catch(() => {
        if (token === generation.current) {
          setView(current => ({ ...current, phase: 'failed' }))
        }
      })
      .finally(() => {
        if (token === generation.current) {
          setBusy(null)
        }
      })
  }

  useEffect(() => {
    // The panel reads again only when the sub-agent or the session changes; Refresh reads it on demand.
    read(0, 'first')
  }, [api, chatId, agentId])

  if (view.phase === 'loading') {
    return <p className="p-4 text-sm text-muted-foreground">Loading the activity…</p>
  }
  return (
    <div className="space-y-3">
      {view.phase === 'failed' && <p className="text-sm text-red-700 dark:text-red-300">The activity could not be loaded. Try Refresh.</p>}
      {view.items.length === 0 && view.phase === 'ready' && <p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
      <MessageRows chatId={chatId} messages={subagentMessages(chatId, view.items)} onOpenSubagent={onOpenSubagent} />
      {view.next !== null && (
        <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => read(view.next ?? 0, 'more')}>
          {busy === 'more' ? 'Loading…' : 'Load more'}
        </Button>
      )}
      <Button variant="ghost" className="w-full" disabled={busy !== null} onClick={() => read(0, 'refresh')}>
        <RefreshCw aria-hidden="true" className={busy === 'refresh' ? 'animate-spin' : undefined} />
        {busy === 'refresh' ? 'Refreshing…' : 'Refresh activity'}
      </Button>
    </div>
  )
}
