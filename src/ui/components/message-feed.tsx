import { Check, CheckCheck, ChevronDown, ChevronUp, CircleAlert, LoaderCircle, Sparkles, Wrench } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, Message } from '../../channel/web/protocol.ts'
import { formatTime, groupMessages, isInterruptedToolGroup, promptQuestionIndex, toolInputText } from '../presentation.ts'
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
}

export function MessageFeed({
  chat,
  messages,
  pendingMessages = [],
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onPromptAction,
  onPromptReply,
  onPickerAction,
}: MessageFeedProps) {
  const grouped = useMemo(() => groupMessages(messages), [messages])

  const feedRef = useRef<HTMLDivElement>(null)
  const wasNearBottom = useRef(true)

  useEffect(() => {
    wasNearBottom.current = true
    if (feedRef.current !== null) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [chat.id])

  useEffect(() => {
    if (wasNearBottom.current && feedRef.current !== null) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [messages.length, pendingMessages.length, chat.busy])

  return (
    <div
      ref={feedRef}
      onScroll={event => {
        const element = event.currentTarget
        wasNearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120
      }}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6"
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
        {grouped.map((entry, index) =>
          entry.kind === 'tool-group' ? (
            <ToolRunGroup
              key={entry.messages[0]?.id ?? index}
              messages={entry.messages}
              interrupted={isInterruptedToolGroup(entry.messages, grouped.slice(index + 1).some(later => later.kind === 'message'))}
            />
          ) : (
            <MessageCard
              key={entry.message.id}
              message={entry.message}
              messages={messages}
              onPromptAction={onPromptAction}
              onPromptReply={onPromptReply}
              onPickerAction={onPickerAction}
            />
          ),
        )}
        {pendingMessages.map(({ message, error, retry }) => (
          <MessageCard key={message.id} message={message} messages={messages} pendingError={error} onRetry={retry} />
        ))}
        {chat.busy && (
          <div className="flex items-center gap-3 px-1 py-2" aria-label="Session is working">
            <div className="grid size-8 place-items-center rounded-xl border border-border bg-card">
              <span className="font-display text-sm">✳</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl border border-border bg-card px-4 py-3">
              <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
              <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
              <span className="typing-dot size-1.5 rounded-full bg-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">Working…</span>
          </div>
        )}
      </div>
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
}

function MessageCard({ message, messages, pendingError, onRetry, onPromptAction, onPromptReply, onPickerAction }: MessageCardProps) {
  if (message.kind === 'user_text') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-[var(--message-pad,_.7rem)] text-primary-foreground shadow-sm sm:max-w-[76%]">
          <p className="whitespace-pre-wrap break-words text-[var(--message-font,1rem)] leading-relaxed">{message.text}</p>
          <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[10px] opacity-70">
            {message.status === 'queued' ? (
              <>
                <span>Queued</span>
                <Check className="size-3" aria-hidden="true" />
              </>
            ) : (
              <>
                <span>Delivered</span>
                <CheckCheck className="size-3" aria-hidden="true" />
              </>
            )}
            <time dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
          </div>
          {pendingError && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-black/10 px-2 py-1.5 text-xs">
              <span>{pendingError}</span>
              {onRetry && <button className="font-semibold underline" onClick={onRetry}>Retry</button>}
            </div>
          )}
        </div>
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
      <article className="max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-card p-4 shadow-sm sm:max-w-[76%]">
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
      <article className="max-w-[88%] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 shadow-sm sm:max-w-[76%]">
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</div>
        <MessageTime at={message.at} />
      </article>
    )
  }

  if (message.kind === 'agent_text') {
    return (
      <article className="flex w-full gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-muted">
          <Sparkles className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 max-w-2xl flex-1">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="font-display font-semibold">Thullab agent</span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">AGENT</span>
            <time className="font-mono text-xs text-muted-foreground" dateTime={new Date(message.at).toISOString()}>{formatTime(message.at)}</time>
          </div>
          <div className="prose prose-sm max-w-none break-words text-[var(--message-font,1rem)] leading-relaxed text-foreground dark:prose-invert prose-p:my-2 prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary prose-a:underline prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[.9em] prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:p-3 prose-blockquote:border-primary/40 prose-th:border-border prose-td:border-border">
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

function MessageTime({ at }: { at: number }) {
  return <div className="mt-2 text-right font-mono text-[10px] text-muted-foreground">{formatTime(at)}</div>
}

function ToolRunGroup({ messages, interrupted }: { messages: Extract<Message, { kind: 'tool_run' }>[]; interrupted: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const running = messages.some(message => message.status === 'running') && !interrupted
  const failed = messages.some(message => message.status === 'error')
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card/75 shadow-sm">
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
              <div className="mt-3 grid gap-3 pl-4">
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Input</div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-[11px] leading-relaxed">{toolInputText(message.input)}</pre>
                </div>
                {message.result !== null && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Result {message.resultTruncated && <span className="normal-case">(truncated by Bridge)</span>}
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-[11px] leading-relaxed">{message.result}</pre>
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

type PromptCardProps = {
  message: Extract<Message, { kind: 'prompt' }>
  questionIndex: number
  onAction?: MessageFeedProps['onPromptAction']
  onReply?: MessageFeedProps['onPromptReply']
}

function PromptCard({ message, questionIndex, onAction, onReply }: PromptCardProps) {
  const [selected, setSelected] = useState<number[]>([])
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pending = message.status === 'pending' && !submitting
  const run = async (action: () => Promise<void>) => {
    setSubmitting(true)
    try {
      await action()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className={`max-w-full overflow-hidden rounded-2xl border shadow-sm sm:max-w-[92%] ${
      message.status === 'pending' ? 'border-amber-500/40 bg-card' : 'border-border bg-card/75'
    }`}>
      <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3.5">
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${
          message.status === 'pending' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-muted text-muted-foreground'
        }`}>
          {message.body.kind === 'permission' ? <ShieldIcon /> : <MessageCircleIcon />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{message.title}</p>
            {message.status === 'pending' ? <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300">Needs you</Badge> : <Badge>Answered</Badge>}
          </div>
          {message.body.kind === 'question' ? (
            message.body.questions.map((question, index) => (
              <div key={`${message.id}-${index}`} className="mt-2">
                {question.header && <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{question.header}</p>}
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
                      <label key={`${message.id}-option-${optionIndex}`} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/70 p-3 hover:bg-muted/60">
                        <input
                          type="checkbox"
                          checked={checked}
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
                  return (
                    <button
                      type="button"
                      key={`${message.id}-option-${optionIndex}`}
                      disabled={!pending}
                      className="rounded-xl border border-border bg-background/70 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50"
                      onClick={() => void run(() => onAction?.(message.chatId, { promptId: message.promptId, questionIndex: index, optionIndex }) ?? Promise.resolve())}
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      {option.description && <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
          <div className="flex gap-2">
            <Input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Write an answer…" disabled={!pending} />
            <Button
              variant="secondary"
              disabled={!pending || answer.trim() === ''}
              onClick={() => void run(() => onReply?.(message.promptId, { questionIndex, text: answer.trim() }) ?? Promise.resolve())}
            >
              Send
            </Button>
          </div>
          {message.body.questions.some(question => question.multiSelect) && selected.length > 0 && (
            <Button
              variant="outline"
              disabled={!pending}
              onClick={() => void run(() => onReply?.(message.promptId, { questionIndex, text: [...selected].sort((a, b) => a - b).map(index => index + 1).join(',') }) ?? Promise.resolve())}
            >
              Submit {selected.length} selected
            </Button>
          )}
        </div>
      )}

      {message.status === 'pending' && message.body.kind === 'permission' && (
        <div className="grid gap-3 p-4">
          <Textarea value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Optional feedback if you deny…" disabled={!pending} className="min-h-20" />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={!pending}
              onClick={() => void run(() => answer.trim()
                ? onReply?.(message.promptId, { questionIndex: 0, text: answer.trim() }) ?? Promise.resolve()
                : onAction?.(message.chatId, { promptId: message.promptId, questionIndex: 0, optionIndex: 1 }) ?? Promise.resolve())}
            >
              Deny
            </Button>
            <Button
              disabled={!pending}
              onClick={() => void run(() => onAction?.(message.chatId, { promptId: message.promptId, questionIndex: 0, optionIndex: 0 }) ?? Promise.resolve())}
            >
              Allow
            </Button>
          </div>
        </div>
      )}

      {message.status === 'answered' && (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          {message.resolution?.note ?? 'Answered'}
          {message.resolution?.source === 'local' && ' in the terminal'}
        </div>
      )}
      {message.status === 'pending' && message.body.kind === 'permission' && <MessageTime at={message.at} />}
    </article>
  )
}

function ShieldIcon() {
  return <span aria-hidden="true" className="text-sm">◇</span>
}

function MessageCircleIcon() {
  return <span aria-hidden="true" className="text-sm">?</span>
}
