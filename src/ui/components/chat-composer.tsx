import { RotateCcw, Send } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Chat } from '../../channel/web/protocol.ts'
import { insertCommand, matchingCommands, moveCommandSelection, slashCommandQuery } from '../command-suggestions.ts'
import { Button } from './ui/button.tsx'

type ChatComposerProps = {
  chat: Chat
  sending: boolean
  onSend(text: string): Promise<void>
  onResume(): Promise<void>
}

export function ChatComposer({ chat, sending, onSend, onResume }: ChatComposerProps) {
  const [text, setText] = useState('')
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const disabled = chat.status === 'ended'
  const query = slashCommandQuery(text)
  const suggestions = matchingCommands(query, chat.id === 'general')
  const suggestionsOpen = suggestions.length > 0 && !suggestionsDismissed
  const activeSuggestionIndex = Math.min(selectedSuggestion, Math.max(0, suggestions.length - 1))

  useEffect(() => {
    setSelectedSuggestion(0)
    setSuggestionsDismissed(false)
  }, [query])

  useEffect(() => {
    const input = inputRef.current
    if (input !== null) {
      input.style.height = 'auto'
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`
    }
  }, [text])

  useEffect(() => {
    const dock = dockRef.current
    const chatSurface = dock?.parentElement
    if (dock === null || dock === undefined || chatSurface === null || chatSurface === undefined) {
      return
    }

    const updateHeight = () => {
      chatSurface.style.setProperty('--chat-composer-height', `${dock.getBoundingClientRect().height}px`)
    }
    const observer = new ResizeObserver(updateHeight)
    observer.observe(dock)
    updateHeight()
    return () => {
      observer.disconnect()
      chatSurface.style.removeProperty('--chat-composer-height')
    }
  }, [])

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
    if (suggestionsOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedSuggestion(index =>
          moveCommandSelection(index, suggestions.length, event.key === 'ArrowDown' ? 1 : -1),
        )
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.nativeEvent.isComposing && suggestions[activeSuggestionIndex]) {
        event.preventDefault()
        setText(current => insertCommand(current, suggestions[activeSuggestionIndex]!.name))
        inputRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        setSuggestionsDismissed(true)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div ref={dockRef} className="chat-composer-dock absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-10 sm:px-6">
      {disabled && (
        <div className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
          <span>This Session has ended. Resume its existing Claude session ID and transcript; this starts a new process, not a fork.</span>
          <Button type="button" size="sm" onClick={() => void onResume()}>
            <RotateCcw aria-hidden="true" />
            Resume this Session
          </Button>
        </div>
      )}
      {suggestionsOpen && (
        <div
          id="chat-command-suggestions"
          role="listbox"
          aria-label="Command suggestions"
          className="absolute bottom-full left-3 right-3 z-10 mx-auto mb-1 max-h-64 max-w-4xl overflow-auto rounded-2xl border border-border bg-card py-1 shadow-xl sm:left-6 sm:right-6"
        >
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.name}
              id={`chat-command-${suggestion.name}`}
              type="button"
              role="option"
              aria-selected={index === activeSuggestionIndex}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setSelectedSuggestion(index)}
              onClick={() => {
                setText(current => insertCommand(current, suggestion.name))
                inputRef.current?.focus()
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left ${index === activeSuggestionIndex ? 'bg-muted' : 'hover:bg-muted/70'}`}
            >
              <span className="font-mono text-sm">/{suggestion.name}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">{suggestion.description}</span>
              <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Command</span>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="mx-auto max-w-4xl">
        <div className={`flex items-end gap-2 rounded-3xl border border-border bg-card pl-4 pr-1.5 py-1.5 ${disabled ? 'opacity-65' : ''}`}>
          <label className="sr-only" htmlFor="chat-composer">{chat.id === 'general' ? 'Send a command' : 'Send an instruction'}</label>
          <textarea
            ref={inputRef}
            id="chat-composer"
            rows={1}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            aria-controls={suggestionsOpen ? 'chat-command-suggestions' : undefined}
            aria-expanded={suggestionsOpen}
            aria-activedescendant={suggestionsOpen ? `chat-command-${suggestions[activeSuggestionIndex]?.name}` : undefined}
            placeholder={disabled ? 'This Session has ended' : chat.id === 'general' ? 'Type /status, /new, /away, /back…' : `Message ${chat.title}…`}
            disabled={disabled}
            className="chat-composer-input max-h-[140px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[var(--message-font,1rem)] leading-relaxed placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon" aria-label="Send message" disabled={disabled || sending || text.trim() === ''} className="mb-0.5 size-9 rounded-full disabled:opacity-30">
            <Send className={sending ? 'animate-pulse' : ''} aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  )
}
