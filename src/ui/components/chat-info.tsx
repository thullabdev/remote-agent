import { AlertTriangle, Archive, ArchiveRestore, Check, Copy, GitFork, Info, Pencil, Pin, PinOff, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { chatState } from '../../channel/web/chat-state.ts'
import type { Chat, PinView, UsageView } from '../../channel/web/protocol.ts'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'
import { Separator } from './ui/separator.tsx'
import { AccountLimitsSection, useNow } from './usage-meters.tsx'
import { formatContextText } from '../usage-format.ts'
import { formatTime, NEEDS_YOU_BADGE_CLASS } from '../presentation.ts'

type ChatInfoProps = {
  chat: Chat
  messageCount: number
  usage: UsageView
  onClose(): void
  onEnd(): Promise<void>
  onArchive(): Promise<void>
  onUnarchive(): Promise<void>
  onRename(title: string): Promise<void>
  /** Pins the session to the top of the list, or unpins it. */
  onPin(pinned: boolean): Promise<void>
  onClear(): Promise<void>
  onFork(): Promise<void>
  onResume(): Promise<void>
  pins: PinView[]
  onUnpin(messageId: string): Promise<void>
  onRefreshPins(): void
  /** Closes the details and shows the pinned message in the chat, loading older history if needed. */
  onJump(pin: PinView): void
}

type Action = 'end' | 'archive' | 'unarchive' | 'clear' | 'fork' | 'resume'

export function ChatInfo({ chat, messageCount, usage, onClose, onEnd, onArchive, onUnarchive, onRename, onPin, onClear, onFork, onResume, pins, onUnpin, onJump, onRefreshPins }: ChatInfoProps) {
  const now = useNow()
  const state = chatState(chat)
  const sessionUsage = usage.chats[chat.id]
  const contextText = sessionUsage === undefined ? null : formatContextText(sessionUsage)
  const [confirm, setConfirm] = useState<Action | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [copied, setCopied] = useState(false)

  const openRename = () => {
    setDraftName(chat.title)
    setRenaming(true)
  }

  const submitRename = async () => {
    setRenaming(false)
    await onRename(draftName.trim())
  }

  const copyPath = async () => {
    if (chat.cwd === null || !navigator.clipboard) {
      return
    }
    await navigator.clipboard.writeText(chat.cwd)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const runAction = async () => {
    const action = confirm
    if (action === null) {
      return
    }
    setConfirm(null)
    if (action === 'end') {
      await onEnd()
    } else if (action === 'archive') {
      await onArchive()
    } else if (action === 'unarchive') {
      await onUnarchive()
    } else if (action === 'clear') {
      await onClear()
    } else if (action === 'resume') {
      await onResume()
    } else {
      await onFork()
    }
  }

  const description = confirm === 'end'
    ? 'Remote Agent will end this spawned session. Its history will remain available.'
    : confirm === 'archive'
      ? 'This moves the ended session out of the main list. You can find it and restore it from Archived.'
      : confirm === 'unarchive'
        ? 'This returns the session to the main list.'
        : confirm === 'clear'
          ? 'This hides the current chat history on every connected device. It does not clear the Session’s context.'
          : confirm === 'resume'
            ? 'Remote Agent will restart this Claude session using its existing session ID and transcript. The ended process cannot be revived, so Claude runs in a new process; this does not fork or create a new session ID.'
            : 'Remote Agent will start a new spawned session from this session’s transcript. The original stays unchanged.'

  return (
    <>
      <aside className="fixed inset-0 z-30 flex justify-end bg-black/30 md:static md:z-auto md:w-80 md:shrink-0 md:bg-transparent">
        <button className="absolute inset-0 md:hidden" onClick={onClose} aria-label="Close session information" />
        <div className="relative flex h-full w-[min(88vw,22rem)] flex-col bg-background shadow-2xl md:w-80 md:shadow-none">
          <header className="flex h-[4.25rem] shrink-0 items-center justify-between px-4">
            <div className="flex items-center gap-2 font-display font-semibold">
              <Info className="size-4 text-muted-foreground" aria-hidden="true" />
              Session details
            </div>
            <Button variant="ghost" size="icon-sm" aria-label="Close session information" onClick={onClose}>
              <X aria-hidden="true" />
            </Button>
          </header>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Session</p>
              <h2 className="mt-1 break-words font-display text-lg font-semibold">{chat.title}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge>{chat.status}</Badge>
                {chat.spawned && <Badge>Spawned</Badge>}
                {chat.archived && <Badge>Archived</Badge>}
                {state === 'working' && <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">Working</Badge>}
                {state === 'needs_you' && <Badge className={NEEDS_YOU_BADGE_CLASS}>Needs you</Badge>}
              </div>
            </section>

            <Separator />
            <InfoRow label="Project" value={chat.project ?? (chat.id === 'general' ? 'General' : 'Not available')} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Working directory</p>
              <div className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-2 py-1.5 font-mono text-xs">{chat.cwd ?? 'Not available'}</code>
                {chat.cwd && (
                  <Button variant="ghost" size="icon-sm" aria-label="Copy working directory" onClick={() => void copyPath()}>
                    {copied ? <Check /> : <Copy />}
                  </Button>
                )}
              </div>
            </div>
            <InfoRow label="Messages" value={String(messageCount)} />
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Pinned messages · {pins.length}</p>
                <Button variant="ghost" size="icon-sm" aria-label="Refresh pinned messages" onClick={onRefreshPins}>
                  <RefreshCw aria-hidden="true" />
                </Button>
              </div>
              {pins.length === 0 ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Pin a message in the chat to keep it here.</p>
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
                        <Button variant="ghost" size="sm" onClick={() => void onUnpin(pin.id)}>Unpin</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {sessionUsage !== undefined && (contextText !== null || sessionUsage.costUsd !== null) && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Usage</p>
                <div className="mt-1 space-y-1 text-sm">
                  {contextText !== null && (
                    <p>
                      Context {contextText.replace('ctx ', '')}
                      {sessionUsage.contextTokens !== null && ` · ${sessionUsage.contextTokens.toLocaleString('en-US')} / ${sessionUsage.contextWindow.toLocaleString('en-US')} tokens`}
                    </p>
                  )}
                  {sessionUsage.costUsd !== null && <p>Cost ${sessionUsage.costUsd.toFixed(2)}</p>}
                </div>
              </div>
            )}
            <AccountLimitsSection accounts={usage.accounts} now={now} />
            {chat.tmuxName && (
              <div className="rounded-2xl bg-card p-3">
                <p className="text-xs font-medium">Attach from a terminal</p>
                <code className="mt-2 block break-all rounded-lg bg-muted px-2 py-1.5 font-mono text-[11px]">tmux attach -t {chat.tmuxName}</code>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">This hint is available for Spawned Sessions only.</p>
              </div>
            )}
            <Separator />
            <div className="grid gap-2">
              {chat.id !== 'general' && (
                <Button variant="outline" className="justify-start" onClick={openRename}>
                  <Pencil aria-hidden="true" />
                  Rename Session
                </Button>
              )}
              {chat.id !== 'general' && !chat.archived && (
                <Button variant="outline" className="justify-start" onClick={() => void onPin(!chat.pinned)}>
                  {chat.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                  {chat.pinned ? 'Unpin Session' : 'Pin to top'}
                </Button>
              )}
              {chat.spawned && chat.status === 'active' && (
                <Button variant="outline" className="justify-start" onClick={() => setConfirm('end')}>
                  <AlertTriangle className="text-amber-700 dark:text-amber-300" aria-hidden="true" />
                  End Spawned Session
                </Button>
              )}
              {chat.id !== 'general' && chat.status === 'ended' && !chat.archived && (
                <Button variant="outline" className="justify-start" onClick={() => setConfirm('archive')}>
                  <Archive aria-hidden="true" />
                  Archive Session
                </Button>
              )}
              {chat.id !== 'general' && chat.archived && (
                <Button variant="outline" className="justify-start" onClick={() => setConfirm('unarchive')}>
                  <ArchiveRestore aria-hidden="true" />
                  Restore from Archived
                </Button>
              )}
              {chat.id !== 'general' && (
                chat.status === 'ended'
                  ? (
                    <Button variant="default" className="justify-start" onClick={() => setConfirm('resume')}>
                      <RotateCcw aria-hidden="true" />
                      Resume this Session
                    </Button>
                  )
                  : (
                    <Button variant="outline" className="justify-start" onClick={() => setConfirm('fork')}>
                      <GitFork aria-hidden="true" />
                      Fork this Session
                    </Button>
                  )
              )}
              <Button variant="outline" className="justify-start text-red-700 hover:text-red-800 dark:text-red-300" onClick={() => setConfirm('clear')}>
                <Trash2 aria-hidden="true" />
                Clear chat history
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <Dialog open={renaming} onOpenChange={open => { if (!open) setRenaming(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Session</DialogTitle>
            <DialogDescription>Leave the name empty to go back to the automatic name.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={event => {
              event.preventDefault()
              void submitRename()
            }}
          >
            <Input
              value={draftName}
              onChange={event => setDraftName(event.target.value)}
              maxLength={120}
              aria-label="Session name"
              autoFocus
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setRenaming(false)}>Cancel</Button>
              <Button type="submit">Save name</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'end'
                ? 'End this Session?'
                : confirm === 'archive'
                  ? 'Archive this Session?'
                  : confirm === 'unarchive'
                    ? 'Restore this Session?'
                    : confirm === 'clear'
                      ? 'Clear chat history?'
                      : confirm === 'resume'
                        ? 'Resume this Session?'
                        : 'Fork this Session?'}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === 'end' || confirm === 'clear' ? 'destructive' : 'default'} onClick={() => void runAction()}>
              {confirm === 'end'
                ? 'End Session'
                : confirm === 'archive'
                  ? 'Archive Session'
                  : confirm === 'unarchive'
                    ? 'Restore Session'
                    : confirm === 'clear'
                      ? 'Clear history'
                      : confirm === 'resume'
                        ? 'Resume Session'
                        : 'Fork Session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm">{value}</p>
    </div>
  )
}
