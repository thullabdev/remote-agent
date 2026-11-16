import type { ReactNode } from 'react'
import { Terminal } from 'lucide-react'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import type { ChatActionContext, DashboardContext } from '../../../src/ui/extension-slots.ts'
import { openTerminalForChat, TERMINAL_TAB } from './actions.ts'
import { projectName, terminalLabel } from './grouping.ts'
import { selectTerminal, useTerminalSessions } from './store.ts'

/** The heading and card shell the host's sections use, so the terminal surfaces look like the rest of the app. */
function Heading({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
      {title}
    </h2>
  )
}

/** Dashboard card: the open shells, each one a row that opens it. */
export function TerminalsDashboardCard({ online, openSideTab }: DashboardContext): ReactNode {
  const terminals = useTerminalSessions()
  if (terminals.length === 0) {
    return null
  }
  return (
    <section aria-labelledby="dash-terminals" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <Heading id="dash-terminals" title="Terminals" />
      <div className="grid min-w-0 gap-1">
        {terminals.map(term => (
          <Button
            key={term.id}
            variant="outline"
            className="h-auto w-full min-w-0 justify-start gap-3 rounded-2xl px-3 py-2 text-left"
            disabled={!online}
            title={`${term.id} · ${term.cwd}`}
            onClick={() => {
              selectTerminal(term.id)
              openSideTab(TERMINAL_TAB)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{terminalLabel(term)}</span>
            <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground">{projectName(term.cwd)}</span>
          </Button>
        ))}
      </div>
    </section>
  )
}

/** Chat header button: the chat's folder shell, reused when one is open there. Shows the terminal side tab. */
export function TerminalChatAction({ chat, openSideTab, notify }: ChatActionContext) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Open a terminal in this session's directory" onClick={() => void openTerminalForChat(chat, openSideTab, notify)}>
      <Terminal className="size-4" aria-hidden="true" />
    </Button>
  )
}
