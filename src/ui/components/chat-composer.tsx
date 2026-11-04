import { ArrowUp, CornerDownLeft, Send, Slash } from 'lucide-react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Chat } from '../../channel/web/protocol.ts'
import { Button } from './ui/button.tsx'

type ChatComposerProps = {
  chat: Chat
  sending: boolean
  onSend(text: string): Promise<void>
}

export function ChatComposer({ chat, sending, onSend }: ChatComposerProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const disabled = chat.status === 'ended'

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = text.trim()
    if (value === '' || disabled || sending) {
      return
    }
    setText('')
    await onSend(value)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className="shrink-0 border-t border-border/80 bg-background/80 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      {disabled && (
        <div className="mx-auto mb-2 max-w-4xl rounded-xl border border-border bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
          This Session has ended. Its history is read-only; fork it to continue.
        </div>
      )}
      <form onSubmit={submit} className="mx-auto max-w-4xl">
        <div className={`rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-primary/45 ${disabled ? 'opacity-65' : ''}`}>
          <label className="sr-only" htmlFor="chat-composer">{chat.id === 'general' ? 'Send a command' : 'Send an instruction'}</label>
          <textarea
            ref={inputRef}
            id="chat-composer"
            rows={2}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={disabled ? 'This Session has ended' : chat.id === 'general' ? 'Type /status, /new, /away…' : 'Send an instruction to this Session…'}
            disabled={disabled}
            className="max-h-44 min-h-[3.6rem] w-full resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed placeholder:text-muted-foreground/80 focus-visible:outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex min-w-0 items-center gap-2 pl-2 text-[10px] text-muted-foreground">
              {chat.id === 'general' ? <Slash className="size-3" aria-hidden="true" /> : <CornerDownLeft className="size-3" aria-hidden="true" />}
              <span className="truncate">{chat.id === 'general' ? 'General is the command surface' : 'Messages queue while the Session is busy'}</span>
            </div>
            <Button type="submit" size="icon-sm" aria-label="Send message" disabled={disabled || sending || text.trim() === ''}>
              {sending ? <Send className="animate-pulse" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Enter to send <span className="mx-1">·</span> Shift+Enter for a new line
        </p>
      </form>
    </div>
  )
}
