import { Send } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
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

  useEffect(() => {
    const input = inputRef.current
    if (input !== null) {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`
    }
  }, [text])

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
    <div className="relative shrink-0 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
      {disabled && (
        <div className="mx-auto mb-2 max-w-4xl rounded-xl border border-border bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
          This Session has ended. Its history is read-only; fork it to continue.
        </div>
      )}
      <form onSubmit={submit} className="mx-auto max-w-4xl">
        <div className={`flex items-end gap-2 rounded-3xl border border-border bg-card pl-4 pr-1.5 py-1.5 transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${disabled ? 'opacity-65' : ''}`}>
          <label className="sr-only" htmlFor="chat-composer">{chat.id === 'general' ? 'Send a command' : 'Send an instruction'}</label>
          <textarea
            ref={inputRef}
            id="chat-composer"
            rows={1}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={disabled ? 'This Session has ended' : chat.id === 'general' ? 'Type /status, /new, /away…' : `Message ${chat.title}…`}
            disabled={disabled}
            className="max-h-[140px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[var(--message-font,1rem)] leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <Button type="submit" size="icon" aria-label="Send message" disabled={disabled || sending || text.trim() === ''} className="mb-0.5 size-9 rounded-full disabled:opacity-30">
            <Send className={sending ? 'animate-pulse' : ''} aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  )
}
