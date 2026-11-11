import { FileText, Image as ImageIcon, Paperclip, RotateCcw, Send, X } from 'lucide-react'
import { memo, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Chat, UploadRecord, UploadRef } from '../../channel/web/protocol.ts'
import { applySuggestion, argumentSuggestions, matchingCommands, moveCommandSelection, slashCommandQuery, type CommandSuggestion } from '../command-suggestions.ts'
import { useDraft, type DraftApi } from '../use-draft.ts'
import { filterUploads, insertReference, isPdf, MAX_ATTACHMENTS_PER_MESSAGE, MAX_UPLOAD_BYTES, mentionQuery, removeMention, removeReferences, toRef } from '../uploads.ts'
import { Button } from './ui/button.tsx'
import { UploadPicker } from './upload-picker.tsx'

type ChatComposerProps = {
  chat: Chat
  sending: boolean
  /** true: Enter sends and Shift+Enter adds a line. false: Enter adds a line and Ctrl/Cmd+Enter sends. */
  enterSends: boolean
  /** Library files attached to this message, in the order they were picked. */
  library: UploadRecord[]
  onRefreshLibrary(): void
  /** Uploads a file to the library and resolves to its reference, or null when it was refused. */
  onUpload(file: File): Promise<UploadRef | null>
  onDeleteUpload(upload: UploadRecord): void
  onSend(text: string, attachments: UploadRef[]): Promise<void>
  onResume(): Promise<void>
  /** Loads and saves this chat's unsent draft. */
  drafts: DraftApi
  /** True while a freshly started Session waits for its first task: the box says so and takes focus. */
  firstTask?: boolean
}

/** Whether a keydown in the composer should send the message, given the Enter preference. */
export function shouldSendOnEnter(
  event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean },
  enterSends: boolean,
): boolean {
  if (event.key !== 'Enter' || event.isComposing) {
    return false
  }
  if (enterSends) {
    return !event.shiftKey
  }
  return event.ctrlKey || event.metaKey
}

const KIND_LABEL = { command: 'Command', flag: 'Option', value: 'Model' } as const

function ChatComposerView({ chat, sending, enterSends, library, onRefreshLibrary, onUpload, onDeleteUpload, onSend, onResume, drafts, firstTask = false }: ChatComposerProps) {
  const { text, setText, attachments, setAttachments } = useDraft(drafts, chat.id)
  const [selectedSuggestion, setSelectedSuggestion] = useState(0)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const dockRef = useRef<HTMLDivElement>(null)
  const disabled = chat.status === 'ended'
  const query = slashCommandQuery(text)
  const suggestions: CommandSuggestion[] = argumentSuggestions(text, chat.id === 'general') ?? matchingCommands(query, chat.id === 'general')
  const suggestionsOpen = suggestions.length > 0 && !suggestionsDismissed
  const activeSuggestionIndex = Math.min(selectedSuggestion, Math.max(0, suggestions.length - 1))

  useEffect(() => {
    if (firstTask) {
      inputRef.current?.focus()
    }
  }, [firstTask])

  useEffect(() => {
    setSelectedSuggestion(0)
    setSuggestionsDismissed(false)
  }, [query, text])

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

  const [uploading, setUploading] = useState(false)
  const [pickerIndex, setPickerIndex] = useState(0)
  const [pickerDismissed, setPickerDismissed] = useState(false)
  const [pickerNote, setPickerNote] = useState<string | null>(null)
  // The picker opens from an open @ token or from the attach button; both use the same list.
  // General takes no file attachments (the Bridge refuses them), so it has no attach button and no library picker.
  const attachable = chat.id !== 'general'
  const mention = attachable ? mentionQuery(text) : null
  const pickerQuery = mention ?? ''
  const pickerOpen = (mention !== null || attachOpen) && !pickerDismissed && !disabled && attachable
  const pickerUploads = pickerOpen ? filterUploads(library, pickerQuery) : []
  const limitReached = attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE

  useEffect(() => {
    setPickerIndex(0)
    setPickerNote(null)
  }, [mention])

  useEffect(() => {
    if (pickerOpen) {
      onRefreshLibrary()
    }
  }, [pickerOpen, onRefreshLibrary])

  const addAttachment = (ref: UploadRef) => {
    setAttachments(current => {
      if (current.some(item => item.id === ref.id)) {
        return current
      }
      return current.length >= MAX_ATTACHMENTS_PER_MESSAGE ? current : [...current, ref]
    })
  }

  /** Attaches the file and writes `@name` into the text, so it can be referred to again. */
  const attachReference = (ref: UploadRef) => {
    if (attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE && !attachments.some(item => item.id === ref.id)) {
      setPickerNote(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`)
      return
    }
    addAttachment(ref)
    setText(current => insertReference(current, ref.name))
  }

  const pick = (upload: UploadRecord) => {
    setAttachOpen(false)
    attachReference(toRef(upload))
    inputRef.current?.focus()
  }

  const uploadFiles = async (files: File[]) => {
    setUploading(true)
    try {
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          setPickerNote('That file is larger than 10 MB.')
          continue
        }
        const ref = await onUpload(file)
        if (ref !== null) {
          attachReference(ref)
        }
      }
      setText(current => removeMention(current))
      setAttachOpen(false)
    } finally {
      setUploading(false)
      inputRef.current?.focus()
    }
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const value = text.trim()
    if ((value === '' && attachments.length === 0) || disabled || sending || uploading) {
      return
    }
    const sent = attachments
    setText('')
    setAttachments([])
    await onSend(value, sent)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && pickerUploads.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setPickerIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + pickerUploads.length) % pickerUploads.length)
        return
      }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing && pickerUploads[pickerIndex] !== undefined) {
        event.preventDefault()
        pick(pickerUploads[pickerIndex]!)
        return
      }
    }
    if (pickerOpen && event.key === 'Escape') {
      setPickerDismissed(true)
      setAttachOpen(false)
      return
    }
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
        const chosen = suggestions[activeSuggestionIndex]!
        setText(current => applySuggestion(current, chosen))
        inputRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        setSuggestionsDismissed(true)
        return
      }
    }
    if (shouldSendOnEnter({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing }, enterSends)) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div ref={dockRef} className="chat-composer-dock absolute inset-x-0 bottom-0 z-10 px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
      {disabled && (
        <div className="mx-auto mb-2 flex max-w-4xl flex-wrap items-center justify-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-center text-xs text-muted-foreground">
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
          className="absolute bottom-full left-3 right-3 z-10 mx-auto mb-1 max-h-64 max-w-4xl overflow-auto rounded-2xl bg-card py-1 shadow-xl sm:left-6 sm:right-6"
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
                setText(current => applySuggestion(current, suggestion))
                inputRef.current?.focus()
              }}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left ${index === activeSuggestionIndex ? 'bg-muted' : 'hover:bg-muted/70'}`}
            >
              <span className="font-mono text-sm">{suggestion.kind === undefined || suggestion.kind === 'command' ? `/${suggestion.name}` : suggestion.name}</span>
              <span className="flex-1 truncate text-xs text-muted-foreground">{suggestion.description}</span>
              <span className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{KIND_LABEL[suggestion.kind ?? 'command']}</span>
            </button>
          ))}
        </div>
      )}
      {pickerOpen && (
        <UploadPicker
          uploads={pickerUploads}
          query={pickerQuery}
          selected={pickerIndex}
          note={pickerNote ?? (limitReached ? `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.` : null)}
          onHover={setPickerIndex}
          onPick={pick}
          onDelete={onDeleteUpload}
          onUploadFiles={files => void uploadFiles(files)}
        />
      )}
      {(attachments.length > 0 || uploading) && (
        <div className="mx-auto mb-1.5 flex max-w-4xl flex-wrap gap-1.5">
          {attachments.map(attachment => (
            <span key={attachment.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-card py-1 pl-2.5 pr-1 text-xs">
              {isPdf(attachment.mime) ? <FileText className="size-3.5 shrink-0" aria-hidden="true" /> : <ImageIcon className="size-3.5 shrink-0" aria-hidden="true" />}
              <span className="truncate">{attachment.name}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => {
                  setAttachments(current => current.filter(item => item.id !== attachment.id))
                  setText(current => removeReferences(current, attachment.name))
                }}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {uploading && <span className="px-2 py-1 text-xs text-muted-foreground">Uploading…</span>}
        </div>
      )}
      <form onSubmit={submit} className="mx-auto max-w-4xl">
        <div className={`flex items-end gap-2 rounded-3xl bg-card pl-4 pr-1.5 py-1.5 shadow-[0_-4px_18px_-6px_rgb(0_0_0/.22),0_10px_28px_-12px_rgb(0_0_0/.35)] ${disabled ? 'opacity-65' : ''}`}>
          <label className="sr-only" htmlFor="chat-composer">{chat.id === 'general' ? 'Send a command' : 'Send an instruction'}</label>
          <textarea
            ref={inputRef}
            id="chat-composer"
            rows={1}
            value={text}
            onChange={event => {
              setText(event.target.value)
              setPickerDismissed(false)
            }}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            aria-controls={suggestionsOpen ? 'chat-command-suggestions' : undefined}
            aria-expanded={suggestionsOpen}
            aria-activedescendant={suggestionsOpen ? `chat-command-${suggestions[activeSuggestionIndex]?.name}` : undefined}
            placeholder={disabled ? 'This Session has ended' : chat.id === 'general' ? 'Type /status, /new, /away, /back…' : firstTask ? 'What should Claude work on?' : `Message ${chat.title}…`}
            disabled={disabled}
            className="chat-composer-input max-h-[140px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[length:var(--message-font,1rem)] leading-relaxed placeholder:text-muted-foreground"
          />
          {attachable && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach file"
              title="Attach an image or PDF"
              aria-pressed={pickerOpen}
              disabled={disabled || uploading || limitReached}
              onClick={() => {
                setPickerDismissed(false)
                setAttachOpen(open => !open)
              }}
              className="mb-0.5 size-9 rounded-full text-muted-foreground disabled:opacity-30"
            >
              <Paperclip aria-hidden="true" />
            </Button>
          )}
          <Button type="submit" size="icon" aria-label="Send message" disabled={disabled || sending || uploading || (text.trim() === '' && attachments.length === 0)} className="mb-0.5 size-9 rounded-full disabled:opacity-30">
            <Send className={sending ? 'animate-pulse' : ''} aria-hidden="true" />
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Memoized so opening the chat details does not re-render the message list or the composer. */
export const ChatComposer = memo(ChatComposerView)
