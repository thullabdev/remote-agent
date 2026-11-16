import { useEffect, type ReactNode } from 'react'
import { Plus, Terminal } from 'lucide-react'
import { Button } from '../../../src/ui/components/ui/button.tsx'
import type { ActivePanel, ChatActionContext, DashboardContext, OpenPanel, SideTabContext } from '../../../src/ui/extension-slots.ts'
import { startTerminal, openTerminalForChat, TERMINAL_PANEL } from './actions.ts'
import { groupByFolder, projectName, terminalLabel } from './grouping.ts'
import { refreshSessions, startSessionEvents, useTerminalSessions, type TerminalSession } from './store.ts'

/** The heading and card shell the host's sections use, so the terminal surfaces look like the rest of the app. */
function Heading({ id, title }: { id: string; title: string }) {
  return (
    <h2 id={id} className="px-1 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">
      {title}
    </h2>
  )
}

function isActive(activePanel: ActivePanel | null, sid: string): boolean {
  return activePanel?.id === TERMINAL_PANEL && activePanel.params.sid === sid
}

/** The terminal side tab: open shells grouped by folder, with a "+" per folder and the chat each one belongs to. */
export function TerminalsSideTab({ chats, activePanel, openPanel, notify }: SideTabContext) {
  const terminals = useTerminalSessions()
  useEffect(() => {
    // The events socket keeps the list current; the one-off read fills it before the first frame arrives.
    startSessionEvents()
    void refreshSessions().catch(() => {
      // The terminal extension may be unreachable; the empty state still shows.
    })
  }, [])
  const groups = groupByFolder(terminals)
  return (
    <section aria-labelledby="side-terminals" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[4.25rem] shrink-0 items-center px-4">
        <Heading id="side-terminals" title="Terminals" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:pb-24">
        {groups.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No terminals open. Use the terminal button in a session&apos;s header to open one.</p>
        )}
        {groups.map(group => (
          <div key={group.cwd} className="mb-2 space-y-0.5">
            <div className="flex items-center gap-2 px-2 pt-1 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate font-medium" title={group.cwd}>
                {group.project}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label={`New terminal in ${group.project}`} title={`New terminal in ${group.cwd}`} onClick={() => void startTerminal({ cwd: group.cwd }, openPanel, notify)}>
                <Plus aria-hidden="true" />
              </Button>
            </div>
            {group.sessions.map(term => (
              <SidebarRow key={term.id} term={term} chatTitle={chatTitleOf(chats, term)} active={isActive(activePanel, term.id)} openPanel={openPanel} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function SidebarRow({ term, chatTitle, active, openPanel }: { term: TerminalSession; chatTitle: string | undefined; active: boolean; openPanel: OpenPanel }) {
  return (
    <button
      type="button"
      title={term.id}
      onClick={() => openPanel(TERMINAL_PANEL, { sid: term.id })}
      className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left text-sm transition-colors ${active ? 'bg-muted' : 'hover:bg-muted/70'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{terminalLabel(term)}</span>
        {chatTitle !== undefined && <span className="block truncate text-xs text-muted-foreground">{chatTitle}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`size-1.5 rounded-full ${term.connected ? 'bg-green-500' : 'bg-muted-foreground/50'}`} aria-hidden="true" />
        {term.connected ? 'attached' : 'detached'}
      </span>
    </button>
  )
}

function chatTitleOf(chats: SideTabContext['chats'], term: TerminalSession): string | undefined {
  return term.chatId ? chats.find(chat => chat.id === term.chatId)?.title : undefined
}

/** Dashboard card: the open shells, each one a row that opens it. */
export function TerminalsDashboardCard({ online, openPanel }: DashboardContext): ReactNode {
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
            onClick={() => openPanel(TERMINAL_PANEL, { sid: term.id })}
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{terminalLabel(term)}</span>
            <span className="min-w-0 max-w-[45%] truncate text-xs text-muted-foreground">{projectName(term.cwd)}</span>
          </Button>
        ))}
      </div>
    </section>
  )
}

/** Chat header button: the chat's folder shell, reused when one is open there. */
export function TerminalChatAction({ chat, openPanel, notify }: ChatActionContext) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Open a terminal in this session's directory" onClick={() => void openTerminalForChat(chat, openPanel, notify)}>
      <Terminal className="size-4" aria-hidden="true" />
    </Button>
  )
}
