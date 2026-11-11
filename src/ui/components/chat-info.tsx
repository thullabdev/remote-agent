import { AlertTriangle, Archive, ArchiveRestore, Check, Copy, EyeOff, GitFork, Monitor, Pencil, Pin, PinOff, RotateCcw, Terminal, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { chatState } from '../../channel/web/chat-state.ts'
import type { Chat, PinView } from '../../channel/web/protocol.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { copyToClipboard } from './code-block.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { RenameDialog } from './rename-dialog.tsx'
import { formatTime, relativeTimeWords, NEEDS_YOU_BADGE_CLASS } from '../presentation.ts'

type ChatInfoProps = {
  chat: Chat
  onClose(): void
  /** Shows a short message, for results that have no request behind them (a copy). */
  onNotify(message: string): void
  onEnd(): Promise<void>
  onArchive(): Promise<void>
  onUnarchive(): Promise<void>
  onRename(title: string): Promise<void>
  /** Pins the session to the top of the list, or unpins it. */
  onPin(pinned: boolean): Promise<void>
  /** Hides the chat history on every device. */
  onClear(): Promise<void>
  onFork(): Promise<void>
  onResume(): Promise<void>
  /** The bookmarked messages of this chat. */
  pins: PinView[]
  onUnpin(messageId: string): Promise<void>
  /** Closes the details and shows the bookmarked message in the chat, loading older history if needed. */
  onJump(pin: PinView): void
}

/** The two actions that still ask first: ending a process and hiding history. The rest are reversible and run at once. */
type Confirm = 'end' | 'clear'

const STATE_LABEL = { needs_you: 'Needs you', working: 'Working', idle: 'Idle', ended: 'Ended' } as const

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{children}</p>
}

function useCopy(onNotify: (message: string) => void): { copied: string | null; copy(key: string, text: string): Promise<void> } {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (key: string, text: string) => {
    if (!(await copyToClipboard(text))) {
      onNotify('Could not copy. Select the text and copy it by hand.')
      return
    }
    setCopied(key)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 1500)
  }
  return { copied, copy }
}

/** True on the narrow layout, where the panel is a sheet over the chat rather than a column beside it. */
function useSheetLayout(): boolean {
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    setSheet(query.matches)
    const onChange = () => setSheet(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return sheet
}

export function ChatInfo({ chat, onClose, onNotify, onEnd, onArchive, onUnarchive, onRename, onPin, onClear, onFork, onResume, pins, onUnpin, onJump }: ChatInfoProps) {
  const state = chatState(chat)
  const isGeneral = chat.id === 'general'
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [renaming, setRenaming] = useState(false)
  const { copied, copy } = useCopy(onNotify)
  const sheet = useSheetLayout()
  const closeButton = useRef<HTMLButtonElement>(null)

  // As a sheet the panel behaves like a dialog: it takes focus on open and Escape puts it away.
  useEffect(() => {
    if (sheet) {
      closeButton.current?.focus()
    }
  }, [sheet])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && sheet) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet, onClose])

  const runConfirmed = async () => {
    const action = confirm
    setConfirm(null)
    if (action === 'end') {
      await onEnd()
    } else if (action === 'clear') {
      await onClear()
    }
  }

  const tmuxCommand = chat.tmuxName === null ? null : `tmux attach -t ${chat.tmuxName}`
  const hasTechnical = chat.cwd !== null || tmuxCommand !== null
  const ended = chat.status === 'ended'

  return (
    <>
      <aside
        role={sheet ? 'dialog' : 'complementary'}
        aria-modal={sheet ? true : undefined}
        aria-label="Session details"
        className="fixed inset-0 z-30 flex justify-end bg-black/30 md:static md:z-auto md:w-80 md:shrink-0 md:bg-transparent"
      >
        <button className="absolute inset-0 md:hidden" tabIndex={-1} onClick={onClose} aria-label="Close session information" />
        <div className="relative flex h-full w-[min(88vw,22rem)] flex-col bg-background shadow-2xl md:w-80 md:shadow-none">
          <header className="flex h-[4.25rem] shrink-0 items-center justify-between px-4">
            <h2 className="font-display font-semibold">Session details</h2>
            <Button ref={closeButton} variant="ghost" size="icon-sm" aria-label="Close session information" onClick={onClose}>
              <X aria-hidden="true" />
            </Button>
          </header>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
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
              {(chat.project !== null || chat.lastMessage !== null) && (
                <dl className="mt-3 space-y-1 text-sm">
                  {chat.project !== null && (
                    <div className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">Project</dt>
                      <dd className="min-w-0 break-words">{chat.project}</dd>
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

            {!isGeneral && (
              <section aria-label="Actions" className="grid gap-2">
                {ended ? (
                  <>
                    <Button className="justify-start" disabled={chat.archived} onClick={() => void onResume()}>
                      <RotateCcw aria-hidden="true" />
                      Resume
                    </Button>
                    <p className="-mt-1 text-xs text-muted-foreground">Starts Claude again with this session&apos;s history.</p>
                  </>
                ) : (
                  <Button className="justify-start" onClick={() => void onFork()}>
                    <GitFork aria-hidden="true" />
                    Fork
                  </Button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {!chat.archived && (
                    <Button variant="outline" className="justify-start" onClick={() => void onPin(!chat.pinned)}>
                      {chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                      {chat.pinned ? 'Unpin' : 'Pin to top'}
                    </Button>
                  )}
                  <Button variant="outline" className="justify-start" onClick={() => setRenaming(true)}>
                    <Pencil aria-hidden="true" />
                    Rename
                  </Button>
                </div>
              </section>
            )}

            <details open={pins.length > 0} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between">
                <SectionLabel>Bookmarks · {pins.length}</SectionLabel>
              </summary>
              {pins.length === 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Tap the bookmark on a message to keep it here.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {pins.map(pin => (
                    <li key={pin.id} className="rounded-xl bg-card p-2.5">
                      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                        <span>{pin.kind === 'user_text' ? 'You' : 'Agent'}</span>
                        <time dateTime={new Date(pin.at).toISOString()}>{formatTime(pin.at)}</time>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm leading-snug">{pin.preview}</p>
                      <div className="mt-1.5 flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onJump(pin)}>Show in chat</Button>
                        <Button variant="ghost" size="sm" onClick={() => void onUnpin(pin.id)}>Remove bookmark</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            {hasTechnical && (
              <details>
                <summary className="cursor-pointer list-none">
                  <SectionLabel>Technical</SectionLabel>
                </summary>
                <div className="mt-2 space-y-3">
                  {chat.cwd !== null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Working directory</p>
                      <div className="mt-1 flex items-start gap-2">
                        <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-2 py-1.5 font-mono text-xs">{chat.cwd}</code>
                        <Button variant="ghost" size="icon-sm" aria-label="Copy working directory" onClick={() => void copy('cwd', chat.cwd ?? '')}>
                          {copied === 'cwd' ? <Check /> : <Copy />}
                        </Button>
                      </div>
                    </div>
                  )}
                  {tmuxCommand !== null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Attach from a terminal</p>
                      <div className="mt-1 flex items-start gap-2">
                        <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-2 py-1.5 font-mono text-xs">{tmuxCommand}</code>
                        <Button variant="ghost" size="icon-sm" aria-label="Copy attach command" onClick={() => void copy('tmux', tmuxCommand)}>
                          {copied === 'tmux' ? <Check /> : <Copy />}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            )}

            <section aria-label="Manage" className="space-y-2 border-t border-border/60 pt-4">
              <SectionLabel>Manage</SectionLabel>
              <div className="grid gap-2">
                {chat.spawned && chat.status === 'active' && (
                  <Button variant="outline" className="justify-start" onClick={() => setConfirm('end')}>
                    <AlertTriangle className="text-amber-700 dark:text-amber-300" aria-hidden="true" />
                    End Spawned Session
                  </Button>
                )}
                {!isGeneral && ended && !chat.archived && (
                  <Button variant="outline" className="justify-start" onClick={() => void onArchive()}>
                    <Archive aria-hidden="true" />
                    Archive
                  </Button>
                )}
                {!isGeneral && chat.archived && (
                  <Button variant="outline" className="justify-start" onClick={() => void onUnarchive()}>
                    <ArchiveRestore aria-hidden="true" />
                    Restore from Archived
                  </Button>
                )}
                <Button variant="outline" className="justify-start text-red-700 hover:text-red-800 dark:text-red-300" onClick={() => setConfirm('clear')}>
                  <EyeOff aria-hidden="true" />
                  Hide history on all devices
                </Button>
              </div>
            </section>
          </div>
        </div>
      </aside>

      <RenameDialog open={renaming} title={chat.title} onClose={() => setRenaming(false)} onRename={onRename} />

      <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === 'end' ? 'End this Session?' : 'Hide chat history?'}</DialogTitle>
            <DialogDescription>
              {confirm === 'end'
                ? 'Remote Agent will end this spawned session. Its history will remain available.'
                : 'This hides the messages shown here on every connected device. Claude keeps its own context, so the session is not reset.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void runConfirmed()}>
              {confirm === 'end' ? 'End Session' : 'Hide history'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
