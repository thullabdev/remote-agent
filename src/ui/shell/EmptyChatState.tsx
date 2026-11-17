import { ArrowRight, MessageSquareText } from 'lucide-react'
import { Button } from '../components/ui/button.tsx'

/** The main area when no chat or panel is open. Desktop only: on the narrow layout the chat list fills the screen. */
export function EmptyChatState({ onStart }: { onStart(): void }) {
  return (
    <div className="chat-glow hidden min-w-0 flex-1 flex-col items-center justify-center px-8 text-center md:flex">
      <div className="grid size-16 place-items-center rounded-3xl bg-card shadow-sm">
        <MessageSquareText className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-5 font-display text-xl font-semibold tracking-tight">Your Sessions, at a glance.</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Choose a Chat to review its full conversation, reply to Prompts, or send an Instruction.
      </p>
      <Button className="mt-5" variant="outline" onClick={onStart}>
        Start a Session <ArrowRight />
      </Button>
    </div>
  )
}
