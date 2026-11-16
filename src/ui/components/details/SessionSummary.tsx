import type { Chat } from '../../../channel/web/protocol.ts'
import { chatState } from '../../../channel/web/chat-state.ts'
import { NEEDS_YOU_BADGE_CLASS, relativeTimeWords } from '../../presentation.ts'
import { Badge } from '../ui/badge.tsx'
import { Monitor, Terminal } from 'lucide-react'

const STATE_LABEL = { needs_you: 'Needs you', working: 'Working', idle: 'Idle', ended: 'Ended' } as const

/** The title, state badges and facts about a session. */
export function SessionSummary({ chat, model }: { chat: Chat; model: string | null }) {
  const state = chatState(chat)
  const isGeneral = chat.id === 'general'
  return (
    <section aria-label="Session">
      <p className="break-words font-display text-lg font-semibold">{chat.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state === 'needs_you' && <Badge className={NEEDS_YOU_BADGE_CLASS}>{STATE_LABEL.needs_you}</Badge>}
        {state === 'working' && <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">{STATE_LABEL.working}</Badge>}
        {(state === 'idle' || state === 'ended') && <Badge>{STATE_LABEL[state]}</Badge>}
        {chat.archived && <Badge>Archived</Badge>}
        {!isGeneral && (
          <span data-origin={chat.spawned ? 'spawned' : 'computer'} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {chat.spawned ? <Terminal className="size-3.5" aria-hidden="true" /> : <Monitor className="size-3.5" aria-hidden="true" />}
            {chat.spawned ? 'Spawned by Remote Agent' : 'Running on your computer'}
          </span>
        )}
      </div>
      {(chat.project !== null || chat.lastMessage !== null || model !== null) && (
        <dl className="mt-3 space-y-1 text-sm">
          {chat.project !== null && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Project</dt>
              <dd className="min-w-0 break-words">{chat.project}</dd>
            </div>
          )}
          {model !== null && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Model</dt>
              <dd className="min-w-0 break-all font-mono text-xs leading-5">{model}</dd>
            </div>
          )}
          {chat.lastMessage !== null && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Last activity</dt>
              <dd>{relativeTimeWords(chat.lastMessage.at)}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  )
}
