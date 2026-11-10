import { ArrowDown, Bookmark, Check, ChevronDown, ChevronUp, CircleAlert, FileText, LoaderCircle, Wrench, X } from 'lucide-react'
import { Fragment, lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { chatState } from '../../channel/web/chat-state.ts'
import type { Chat, Message, UploadRef } from '../../channel/web/protocol.ts'
import { NEEDS_YOU_BADGE_CLASS, commandToolInput, dayKey, diffLines, editToolInput, formatDayLabel, formatTime, groupMessages, isInterruptedToolGroup, isMarkdownFilePath, promptQuestionIndex, toolInputText, markChangedRanges, writeToolInput, type DiffLine } from '../presentation.ts'
import { agentInfo } from '../agents.ts'
import { isPdf, uploadUrl } from '../uploads.ts'
import { CodeBlock } from './code-block.tsx'
import { Badge } from './ui/badge.tsx'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'
import { Textarea } from './ui/textarea.tsx'

const MarkdownBody = lazy(() => import('./markdown-body.tsx'))

type MessageFeedProps = {
  chat: Chat
  messages: Message[]
  pendingMessages?: { message: Message; error: string | null; retry(): void }[]
  hasMore: boolean
  loadingEarlier: boolean
  onLoadEarlier(): void
  onPromptAction(chatId: string, body: { promptId: string; questionIndex: number; optionIndex: number }): Promise<void>
  onPromptReply(promptId: string, body: { questionIndex: number; text: string }): Promise<void>
  onPickerAction(chatId: string, body: { pickerId: string; choice: number }): Promise<void>
  onTogglePin?(message: Message): void
}

/** Scrolls a loaded message into view. False when it is not in the feed (for example an older page not loaded yet). */
export function scrollToMessage(messageId: string): boolean {
  const element = document.getElementById(`message-${messageId}`)
  if (element === null) {
    return false
  }
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  return true
}

function MessageFeedView({
  chat,
  messages,
  pendingMessages = [],
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onPromptAction,
  onPromptReply,
  onPickerAction,
  onTogglePin,
}: MessageFeedProps) {
  const grouped = useMemo(() => groupMessages(messages), [messages])

  const feedRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)
  const [awayFromLatest, setAwayFromLatest] = useState(false)

  useEffect(() => {
    wasNearBottom.current = true
    setAwayFromLatest(false)
    if (feedRef.current !== null) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [chat.id])

  useEffect(() => {
    if (wasNearBottom.current && feedRef.current !== null) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages.length, pendingMessages.length, chat.busy])

  // Rows grouped by local calendar day. Each day is its own section, so its date label
  // sticks only while that day is on screen and scrolls away with it.
  const dayGroups: { day: string | null; at: number | null; nodes: ReactNode[] }[] = []
  const addRow = (key: string, at: number | undefined, node: ReactNode) => {
    const element = <Fragment key={key}>{node}</Fragment>
    const last = dayGroups.at(-1)
    if (at === undefined) {
      if (last === undefined) {
        dayGroups.push({ day: null, at: null, nodes: [element] })
      } else {
        last.nodes.push(element)
      }
      return
    }
    const day = dayKey(at)
    if (last !== undefined && last.day === day) {
      last.nodes.push(element)
      return
    }
    dayGroups.push({ day, at, nodes: [element] })
  }
  grouped.forEach((entry, index) => {
    if (entry.kind === 'tool-group') {
      addRow(
        `tools-${entry.messages[0]?.id ?? index}`,
        entry.messages[0]?.at,
        <ToolRunGroup
          messages={entry.messages}
          interrupted={isInterruptedToolGroup(entry.messages, grouped.slice(index + 1).some(later => later.kind === 'message'))}
        />,
      )
      return
    }
    addRow(
      entry.message.id,
      entry.message.at,
      <div id={`message-${entry.message.id}`}>
        <MessageCard
          message={entry.message}
          messages={messages}
          onPromptAction={onPromptAction}
          onPromptReply={onPromptReply}
          onPickerAction={onPickerAction}
          onTogglePin={onTogglePin}
        />
      </div>,
    )
  })
  pendingMessages.forEach(({ message, error, retry }) => {
    addRow(message.id, message.at, <MessageCard message={message} messages={messages} pendingError={error} onRetry={retry} />)
  })

  const jumpToLatest = () => {
    wasNearBottom.current = true
    setAwayFromLatest(false)
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={feedRef}
        onScroll={event => {
          const element = event.currentTarget
          const near = element.scrollHeight - element.scrollTop - element.clientHeight < 120
          wasNearBottom.current = near
          setAwayFromLatest(!near)
        }}
        className="chat-message-feed min-h-0 flex-1 overflow-y-auto px-3 pt-2 sm:px-6"
      >
        {hasMore && (
          <div className="mb-5 text-center">
            <Button variant="outline" size="sm" onClick={() => { wasNearBottom.current = false; onLoadEarlier() }} disabled={loadingEarlier}>
              {loadingEarlier ? <LoaderCircle className="animate-spin" /> : <ChevronUp />}
              {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
            </Button>
          </div>
        )}
        {messages.length === 0 && pendingMessages.length === 0 && (
          <div className="mx-auto my-auto max-w-sm rounded-3xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
            <div className="mx-auto mb-3 grid size-10 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Wrench className="size-4" aria-hidden="true" />
            </div>
            <p className="font-display font-medium">{chat.id === 'general' ? 'Start with a command' : 'A fresh conversation'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {chat.id === 'general' ? 'Try /status, /new, /away, or /back.' : 'Send an instruction to this Session below.'}
            </p>
          </div>
        )}
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-[var(--message-gap,_.75rem)]">
          {dayGroups.map((group, index) => (
            <section key={group.day ?? `untimed-${index}`} className="flex flex-col gap-[var(--message-gap,_.75rem)]">
              {group.at !== null && <DateSeparator at={group.at} />}
              {group.nodes}
            </section>
          ))}
          {chatState(chat) === 'working' && (
            <div className="flex items-center gap-3 px-1 py-2" aria-label="Session is working">
              <div className="grid size-8 place-items-center rounded-xl bg-card">
                <span className="font-display text-sm">✳</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl bg-card px-4 py-3">
                <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
                <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
                <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Working…</span>
            </div>
          )}
        </div>
      </div>
      {awayFromLatest && (
        <Button
          variant="outline"
          size="icon"
          className="absolute right-4 z-20 rounded-full bg-card shadow-md bottom-[calc(var(--chat-composer-height,5rem)+0.75rem)] sm:right-6"
          aria-label="Jump to latest message"
          title="Jump to latest message"
          onClick={jumpToLatest}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

/** A day label that stays at the top of the feed while its messages scroll under it. */
function DateSeparator({ at }: { at: number }) {
  return (
    <div className="sticky top-2 z-10 flex justify-center py-1">
      <span className="rounded-full border border-border/60 bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground shadow-sm">
        {formatDayLabel(at)}
      </span>
    </div>
  )
}

type MessageCardProps = {
  message: Message
  messages: Message[]
  pendingError?: string | null
  onRetry?: () => void
  onPromptAction?: MessageFeedProps['onPromptAction']
  onPromptReply?: MessageFeedProps['onPromptReply']
  onPickerAction?: MessageFeedProps['onPickerAction']
  onTogglePin?: MessageFeedProps['onTogglePin']
}

const PIN_HOLD_MS = 500

/** Shows that a message is pinned. Pinning itself is done by holding the message (see PressToPin). */
function PinMark({ pinned }: { pinned: boolean }) {
  if (!pinned) {
    return null
  }
  return <Bookmark className="size-3 fill-current" aria-label="Pinned" role="img" />
}

function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin message' : 'Pin message'}
      title={pinned ? 'Unpin message' : 'Pin message'}
      className={`rounded-md p-1 text-current transition-opacity hover:bg-black/5 ${pinned ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
    >
      <Bookmark className={`size-3.5 ${pinned ? 'fill-current' : ''}`} aria-hidden="true" />
    </button>
  )
}

/**
 * Holding a message for a moment toggles its pin, so the feed carries no per-message buttons. Taps on controls
 * inside the message (links, buttons) do not start a hold. A hold also suppresses the long-press context menu.
 */
function PressToPin({ onToggle, children, className }: { onToggle(): void; children: ReactNode; className?: string }) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  useEffect(() => cancel, [])

  return (
    <div
      className={className}
      onPointerDown={event => {
        if ((event.target as HTMLElement).closest('a, button, input, label, textarea, select, summary') !== null) {
          return
        }
        fired.current = false
        cancel()
        timer.current = window.setTimeout(() => {
          timer.current = null
          fired.current = true
          navigator.vibrate?.(12)
          onToggle()
        }, PIN_HOLD_MS)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onPointerMove={cancel}
      onContextMenu={event => {
        if (fired.current) {
          event.preventDefault()
        }
      }}
    >
      {children}
    </div>
  )
}

function MessageCard({ message, messages, pendingError, onRetry, onPromptAction, onPromptReply, onPickerAction, onTogglePin }: MessageCardProps) {
  if (message.kind === 'user_text') {
    return (
      <div className="flex justify-end">
        <PressToPin
          className="max-w-[88%] rounded-2xl rounded-br-md bg-accent px-4 py-[var(--message-pad,_.7rem)] text-foreground shadow-sm sm:max-w-[76%]"
          onToggle={() => onTogglePin?.(message)}
        >
          {message.text !== '' && <p className="whitespace-pre-wrap break-words text-[length:var(--message-font,1rem)] leading-relaxed">{message.text}</p>}
          {message.attachments !== undefined && message.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map(attachment => (
                <AttachmentView key={attachment.id} attachment={attachment} />
              ))}
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
            {message.status === 'queued' && <span>Sending…</span>}
            <PinMark pinned={message.pinned === true} />
            <time dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
          </div>
          {pendingError && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-black/10 px-2 py-1.5 text-xs">
              <span>{pendingError}</span>
              {onRetry && <button className="font-semibold underline" onClick={onRetry}>Retry</button>}
            </div>
          )}
        </PressToPin>
      </div>
    )
  }

  if (message.kind === 'prompt') {
    const questionIndex = promptQuestionIndex(messages, message.id)
    return (
      <PromptCard
        message={message}
        questionIndex={questionIndex}
        onAction={onPromptAction}
        onReply={onPromptReply}
      />
    )
  }

  if (message.kind === 'picker') {
    return (
      <article className="max-w-[88%] rounded-2xl rounded-bl-md bg-card p-4 shadow-sm sm:max-w-[76%]">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {message.buttons.map(button => (
            <Button
              key={`${message.pickerId}-${button.choice}`}
              variant="outline"
              size="sm"
              onClick={() => void onPickerAction?.(message.chatId, { pickerId: message.pickerId, choice: button.choice })}
            >
              {button.label}
            </Button>
          ))}
        </div>
        <MessageTime at={message.at} />
      </article>
    )
  }

  if (message.kind === 'system') {
    return (
      <div className="flex justify-center py-1">
        <div className="rounded-full border border-border/70 bg-card/80 px-3 py-1.5 text-center text-xs text-muted-foreground">
          {message.text}
          <time className="ml-2 font-mono text-[10px] opacity-70" dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
        </div>
      </div>
    )
  }

  if (message.kind === 'command_reply') {
    return (
      <article className="max-w-[88%] rounded-2xl rounded-bl-md bg-card px-4 py-3 shadow-sm sm:max-w-[76%]">
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</div>
        <MessageTime at={message.at} />
      </article>
    )
  }

  if (message.kind === 'agent_text') {
    // agent_text messages do not carry an agent id yet, so they show the default agent.
    const agent = agentInfo(undefined)
    return (
      <article className="min-w-0 w-full max-w-2xl px-4 py-[var(--message-pad,_.7rem)]">
        <div className="mb-2 flex items-center gap-2 text-sm">
          <span className="font-display font-semibold">{agent.name}</span>
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">AGENT</span>
          <time className="font-mono text-xs text-muted-foreground" dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
          {onTogglePin && (
            <span className="ml-auto">
              <PinButton pinned={message.pinned === true} onToggle={() => onTogglePin(message)} />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="prose max-w-none break-words text-[length:var(--message-font,1rem)] leading-relaxed text-foreground dark:prose-invert prose-p:my-2 prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary prose-a:underline prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[.9em] prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:p-3 prose-blockquote:border-primary/40 prose-th:border-border prose-td:border-border">
            <Suspense fallback={<div className="text-sm text-muted-foreground">Rendering message…</div>}>
              <MarkdownBody markdown={message.markdown} />
            </Suspense>
          </div>
        </div>
      </article>
    )
  }

  return null
}

/** An attached library file: the image itself, or a PDF link. A file that was deleted from the library shows as removed. */
function AttachmentView({ attachment }: { attachment: UploadRef }) {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return <span className="rounded-lg bg-black/10 px-2 py-1 text-xs">{attachment.name} (removed)</span>
  }
  if (isPdf(attachment.mime)) {
    return (
      <a href={uploadUrl(attachment.id)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-black/10 px-2 py-1 text-xs">
        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{attachment.name}</span>
      </a>
    )
  }
  return (
    <a href={uploadUrl(attachment.id)} target="_blank" rel="noreferrer" className="block max-w-full">
      <img src={uploadUrl(attachment.id)} alt={attachment.name} loading="lazy" onError={() => setMissing(true)} className="max-h-48 max-w-[14rem] rounded-lg object-cover" />
    </a>
  )
}

function MessageTime({ at }: { at: number }) {
  return <div className="mt-2 text-right font-mono text-[10px] text-muted-foreground">{formatTime(at)}</div>
}

function ToolRunGroup({ messages, interrupted }: { messages: Extract<Message, { kind: 'tool_run' }>[]; interrupted: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const running = messages.some(message => message.status === 'running') && !interrupted
  const failed = messages.some(message => message.status === 'error')
  return (
    <section className={`overflow-hidden rounded-2xl bg-card/75 shadow-sm ${expanded || running ? 'border border-foreground/8' : ''}`}>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className={`grid size-8 place-items-center rounded-xl ${failed ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-muted text-muted-foreground'}`}>
          {running ? <LoaderCircle className="size-4 animate-spin" /> : failed ? <CircleAlert className="size-4" /> : <Wrench className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">{running ? 'Tools running' : failed ? 'Tool activity · needs attention' : interrupted ? 'Tool activity · interrupted' : 'Agent activity'}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
            {messages.map(message => message.tool).join('  ·  ')}
          </span>
        </span>
        <Badge>{messages.length} {messages.length === 1 ? 'step' : 'steps'}</Badge>
        {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="divide-y divide-border border-t border-border">
          {messages.map(message => (
            <details key={message.id} className="group px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
                <span className={`size-1.5 rounded-full ${message.status === 'error' ? 'bg-red-500' : message.status === 'running' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                <span className="font-mono font-medium">{message.tool}</span>
                <span className="ml-auto text-muted-foreground">{message.status === 'running' && interrupted ? 'interrupted' : message.durationMs === null ? message.status : `${(message.durationMs / 1000).toFixed(1)}s`}</span>
              </summary>
              <div className="mt-3 grid min-w-0 gap-3 pl-4">
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Input</div>
                  <ToolInput input={message.input} />
                </div>
                {message.result !== null && (
                  <div className="min-w-0">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Result {message.resultTruncated && <span className="normal-case">(shortened)</span>}
                    </div>
                    <CodeBlock preClassName="max-h-96 max-w-full overflow-auto overscroll-x-contain whitespace-pre rounded-xl bg-muted p-3 pr-11 font-mono text-[11px] leading-relaxed">{message.result}</CodeBlock>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

function ToolInput({ input }: { input: unknown }) {
  const commandInput = commandToolInput(input)
  if (commandInput !== null) {
    return (
      <div className="overflow-hidden rounded-xl bg-muted">
        <CodeBlock preClassName="max-w-full overflow-x-auto overscroll-x-contain whitespace-pre px-3 py-2.5 pr-11 font-mono text-[11px] leading-relaxed">
          <code>{commandInput.command}</code>
        </CodeBlock>
        {(commandInput.description !== undefined || commandInput.timeout !== undefined || commandInput.runInBackground !== undefined) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
            {commandInput.description !== undefined && <span className="min-w-0 flex-1">{commandInput.description}</span>}
            {commandInput.timeout !== undefined && (
              <span className="shrink-0 rounded-md bg-card/70 px-1.5 py-0.5 font-mono text-[10px]">
                Timeout · {commandInput.timeout} ms
              </span>
            )}
            {commandInput.runInBackground !== undefined && (
              <span className="shrink-0 rounded-md bg-card/70 px-1.5 py-0.5 font-mono text-[10px]">
                {commandInput.runInBackground ? 'Background' : 'Foreground'}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  const editInput = editToolInput(input)
  if (editInput !== null) {
    const lines = markChangedRanges(diffLines(editInput.oldString, editInput.newString))
    const added = lines.filter(line => line.kind === 'add').length
    const removed = lines.filter(line => line.kind === 'remove').length
    return (
      <div className="overflow-hidden rounded-xl bg-muted">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Edit</span>
          <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{editInput.filePath}</code>
          {editInput.replaceAll && <Badge>all occurrences</Badge>}
          <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">+{added}</span>
          <span className="font-mono text-[10px] text-red-700 dark:text-red-300">−{removed}</span>
        </div>
        <DiffView lines={lines} />
      </div>
    )
  }

  const writeInput = writeToolInput(input)
  if (writeInput !== null) {
    return (
      <div className="overflow-hidden rounded-xl bg-muted">
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">File</span>
          <code className="min-w-0 break-all font-mono text-xs text-foreground">{writeInput.filePath}</code>
        </div>
        {isMarkdownFilePath(writeInput.filePath) ? (
          <div className="max-h-96 max-w-full overflow-auto overscroll-x-contain p-3">
            <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary prose-a:underline prose-code:rounded prose-code:bg-card/70 prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[.9em] prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-card/70 prose-pre:p-3 prose-blockquote:border-primary/40 prose-th:border-border prose-td:border-border">
              <Suspense fallback={<div className="text-sm text-muted-foreground">Rendering Markdown…</div>}>
                <MarkdownBody markdown={writeInput.content} />
              </Suspense>
            </div>
          </div>
        ) : (
          <CodeBlock preClassName="max-h-96 max-w-full overflow-auto overscroll-x-contain whitespace-pre rounded-b-xl p-3 pr-11 font-mono text-[11px] leading-relaxed">
            <code>{writeInput.content}</code>
          </CodeBlock>
        )}
      </div>
    )
  }

  return (
    <CodeBlock preClassName="max-w-full overflow-x-auto overscroll-x-contain whitespace-pre rounded-xl bg-muted p-3 pr-11 font-mono text-[11px] leading-relaxed">
      {toolInputText(input)}
    </CodeBlock>
  )
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="max-h-96 max-w-full overflow-auto overscroll-x-contain font-mono text-[11px] leading-relaxed" role="region" aria-label="Changes">
      <div className="min-w-max py-1">
        {lines.map((line, index) => (
          <div
            key={index}
            className={`flex whitespace-pre px-3 ${
              line.kind === 'add'
                ? 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
                : line.kind === 'remove'
                  ? 'bg-red-500/10 text-red-900 dark:text-red-200'
                  : 'text-muted-foreground'
            }`}
          >
            <span className="w-4 shrink-0 select-none opacity-70" aria-hidden="true">
              {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}
            </span>
            <DiffText line={line} />
          </div>
        ))}
      </div>
    </div>
  )
}

function DiffText({ line }: { line: DiffLine }) {
  if (line.text === '') {
    return <span>{' '}</span>
  }
  if (line.changed === undefined || line.changed.start >= line.changed.end) {
    return <span>{line.text}</span>
  }
  const { start, end } = line.changed
  const changedClass = line.kind === 'add' ? 'rounded-sm bg-emerald-500/35' : 'rounded-sm bg-red-500/35'
  return (
    <span>
      {line.text.slice(0, start)}
      <span className={changedClass}>{line.text.slice(start, end)}</span>
      {line.text.slice(end)}
    </span>
  )
}

/**
 * What the card shows about an answer the user just gave: which choice was pressed, and whether it is still being sent, was sent
 * (the session has not confirmed yet), or failed. The tapped choice stays marked, so the card never looks as if nothing happened.
 */
export type PromptFeedback =
  | { phase: 'idle' }
  | { phase: 'sending' | 'sent'; key: string }
  | { phase: 'error'; message: string }

type PromptCardProps = {
  message: Extract<Message, { kind: 'prompt' }>
  questionIndex: number
  onAction?: MessageFeedProps['onPromptAction']
  onReply?: MessageFeedProps['onPromptReply']
  /** Where the card starts. Only tests set it. */
  initialFeedback?: PromptFeedback
}

type ChoicePhase = 'sending' | 'sent'

/** Marks a button that was pressed: a spinner while sending, a check once sent. */
function ChoiceMark({ phase }: { phase: ChoicePhase | undefined }) {
  if (phase === undefined) {
    return null
  }
  return phase === 'sending' ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : <Check className="size-4 shrink-0" aria-hidden="true" />
}

function pressedLabel(phase: ChoicePhase | undefined, idle: string, sending: string, sent: string): string {
  return phase === 'sending' ? sending : phase === 'sent' ? sent : idle
}

/** The note of a resolution, with where it was answered when the note does not already say. */
function resolutionText(resolution: { note: string; source: 'local' | 'remote' } | null): string {
  if (resolution === null) {
    return 'Answered'
  }
  return resolution.source === 'local' && !resolution.note.toLowerCase().includes('terminal') ? `${resolution.note} (in the terminal)` : resolution.note
}

/** What was decided, in plain sight: the chosen answer (the chosen option marked among the others), or Allowed / Denied. */
function AnsweredResult({ message }: { message: Extract<Message, { kind: 'prompt' }> }) {
  const note = resolutionText(message.resolution)
  if (message.body.kind === 'permission') {
    const denied = note.startsWith('Denied')
    return (
      <div data-result="true" className="flex items-start gap-2 px-4 py-3">
        {denied ? <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Check className="mt-0.5 size-4 shrink-0 text-status-working" aria-hidden="true" />}
        <p className="text-sm font-medium">{note}</p>
      </div>
    )
  }
  return (
    <div className="grid gap-3 px-4 py-3">
      {message.body.questions.map((question, index) => {
        const answered = question.answered
        return (
          <div key={`${message.id}-result-${index}`} className="grid gap-2">
            {question.options.length > 0 && (
              <div className="grid gap-1.5">
                {question.options.map((option, optionIndex) => {
                  const chosen = answered === option.label
                  return (
                    <div
                      key={`${message.id}-result-option-${optionIndex}`}
                      data-chosen={chosen ? 'true' : undefined}
                      className={`flex items-start gap-3 rounded-xl p-3 ${chosen ? 'border border-primary bg-primary/10' : 'bg-background/40 opacity-50'}`}
                    >
                      <span className="mt-0.5 grid size-4 shrink-0 place-items-center">{chosen && <Check className="size-4" aria-hidden="true" />}</span>
                      <span className="block text-sm font-medium">{option.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
            <div data-result="true" className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-status-working" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">You answered</p>
                <p className="text-sm font-medium">{answered ?? note}</p>
              </div>
            </div>
          </div>
        )
      })}
      {message.resolution?.source === 'local' && <p className="text-xs text-muted-foreground">Answered in the terminal</p>}
    </div>
  )
}

export function PromptCard({ message, questionIndex, onAction, onReply, initialFeedback = { phase: 'idle' } }: PromptCardProps) {
  const [selected, setSelected] = useState<number[]>([])
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<PromptFeedback>(initialFeedback)
  const active = feedback.phase === 'sending' || feedback.phase === 'sent' ? feedback : null
  const canAct = message.status === 'pending' && active === null
  const choiceOf = (key: string): ChoicePhase | undefined => (active !== null && active.key === key ? active.phase : undefined)
  const run = async (key: string, action: () => Promise<void>) => {
    setFeedback({ phase: 'sending', key })
    try {
      await action()
      setFeedback({ phase: 'sent', key })
    } catch (reason) {
      setFeedback({ phase: 'error', message: reason instanceof Error ? reason.message : 'Could not send your answer. Try again.' })
    }
  }
  const choose = (key: string, optionIndex: number, index: number) =>
    void run(key, () => onAction?.(message.chatId, { promptId: message.promptId, questionIndex: index, optionIndex }) ?? Promise.resolve())

  return (
    <article className={`max-w-full overflow-hidden rounded-2xl shadow-sm sm:max-w-[92%] ${
      message.status === 'pending' ? 'border border-status-needs/40 bg-card' : 'bg-card/75'
    }`}>
      <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3.5">
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${
          message.status === 'pending' ? 'bg-status-needs/10 text-status-needs' : 'bg-muted text-muted-foreground'
        }`}>
          {message.body.kind === 'permission' ? <ShieldIcon /> : <MessageCircleIcon />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{message.title}</p>
            {message.status === 'pending' ? <Badge className={NEEDS_YOU_BADGE_CLASS}>Needs you</Badge> : <Badge>Answered</Badge>}
          </div>
          {message.body.kind === 'question' ? (
            message.body.questions.map((question, index) => (
              <div key={`${message.id}-${index}`} className="mt-2">
                {question.header && <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{question.header}</p>}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{question.question}</p>
              </div>
            ))
          ) : (
            <div className="mt-1.5">
              <p className="text-sm font-medium">{message.body.summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {message.body.tool}
                {message.body.reason ? ` · ${message.body.reason}` : ''}
              </p>
            </div>
          )}
        </div>
      </div>

      {message.status === 'pending' && message.body.kind === 'question' && (
        <div className="grid gap-3 p-4">
          {message.body.questions.map((question, offset) => {
            const index = questionIndex + offset
            return (
              <div key={`${message.id}-answers-${offset}`} className="grid gap-2">
                {question.options.map((option, optionIndex) => {
                  const checked = selected.includes(optionIndex)
                  if (question.multiSelect) {
                    return (
                      <label key={`${message.id}-option-${optionIndex}`} className="flex cursor-pointer items-start gap-3 rounded-xl bg-background/70 p-3 hover:bg-muted/60">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canAct}
                          onChange={() => setSelected(current => checked ? current.filter(item => item !== optionIndex) : [...current, optionIndex])}
                          className="mt-1 accent-[var(--primary)]"
                        />
                        <span>
                          <span className="block text-sm font-medium">{option.label}</span>
                          {option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}
                        </span>
                      </label>
                    )
                  }
                  const key = `option:${optionIndex}`
                  const phase = choiceOf(key)
                  return (
                    <button
                      type="button"
                      key={`${message.id}-option-${optionIndex}`}
                      disabled={!canAct}
                      data-choice={phase}
                      className={`flex items-start gap-3 rounded-xl p-3 text-left transition-colors ${
                        phase !== undefined ? 'border border-primary bg-primary/10' : 'bg-background/70 hover:bg-muted disabled:opacity-50'
                      }`}
                      onClick={() => choose(key, optionIndex, index)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{option.label}</span>
                        {option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}
                      </span>
                      <ChoiceMark phase={phase} />
                    </button>
                  )
                })}
              </div>
            )
          })}
          <div className="flex gap-2">
            <Input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Write an answer…" disabled={!canAct} />
            <Button
              variant="secondary"
              disabled={!canAct || answer.trim() === ''}
              onClick={() => void run('text', () => onReply?.(message.promptId, { questionIndex, text: answer.trim() }) ?? Promise.resolve())}
            >
              <ChoiceMark phase={choiceOf('text')} />
              {pressedLabel(choiceOf('text'), 'Send', 'Sending…', 'Sent')}
            </Button>
          </div>
          {message.body.questions.some(question => question.multiSelect) && (selected.length > 0 || choiceOf('multi') !== undefined) && (
            <Button
              variant="outline"
              disabled={!canAct}
              onClick={() => void run('multi', () => onReply?.(message.promptId, { questionIndex, text: [...selected].sort((a, b) => a - b).map(index => index + 1).join(',') }) ?? Promise.resolve())}
            >
              <ChoiceMark phase={choiceOf('multi')} />
              {pressedLabel(choiceOf('multi'), `Submit ${selected.length} selected`, 'Sending…', 'Sent')}
            </Button>
          )}
          <FeedbackLine feedback={feedback} />
        </div>
      )}

      {message.status === 'pending' && message.body.kind === 'permission' && (
        <div className="grid gap-3 p-4">
          <Textarea value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Optional feedback if you deny…" disabled={!canAct} className="min-h-20" />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={!canAct}
              data-choice={choiceOf('deny')}
              onClick={() => void run('deny', () => answer.trim()
                ? onReply?.(message.promptId, { questionIndex: 0, text: answer.trim() }) ?? Promise.resolve()
                : onAction?.(message.chatId, { promptId: message.promptId, questionIndex: 0, optionIndex: 1 }) ?? Promise.resolve())}
            >
              <ChoiceMark phase={choiceOf('deny')} />
              {pressedLabel(choiceOf('deny'), 'Deny', 'Denying…', 'Denied')}
            </Button>
            <Button
              disabled={!canAct}
              data-choice={choiceOf('allow')}
              onClick={() => void run('allow', () => onAction?.(message.chatId, { promptId: message.promptId, questionIndex: 0, optionIndex: 0 }) ?? Promise.resolve())}
            >
              <ChoiceMark phase={choiceOf('allow')} />
              {pressedLabel(choiceOf('allow'), 'Allow', 'Allowing…', 'Allowed')}
            </Button>
          </div>
          <FeedbackLine feedback={feedback} />
        </div>
      )}

      {message.status === 'answered' && <AnsweredResult message={message} />}
      {message.status === 'pending' && message.body.kind === 'permission' && <MessageTime at={message.at} />}
    </article>
  )
}

/** One line under the choices that says what is happening with the answer, so the user is never left guessing. */
function FeedbackLine({ feedback }: { feedback: PromptFeedback }) {
  if (feedback.phase === 'idle') {
    return null
  }
  if (feedback.phase === 'error') {
    return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{feedback.message}</p>
  }
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {feedback.phase === 'sending' ? 'Sending your answer…' : 'Sent. Waiting for the session to continue…'}
    </p>
  )
}

function ShieldIcon() {
  return <span aria-hidden="true" className="text-sm">◇</span>
}

function MessageCircleIcon() {
  return <span aria-hidden="true" className="text-sm">?</span>
}

/** Memoized so opening the chat details does not re-render the message list or the composer. */
export const MessageFeed = memo(MessageFeedView)
