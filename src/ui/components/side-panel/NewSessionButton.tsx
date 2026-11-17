import { Plus } from 'lucide-react'
import { Button } from '../ui/button.tsx'

/** The round "new session" button over the list on the narrow layout. The desktop version lives in the header. */
export function NewSessionButton({ onNew }: { onNew(): void }) {
  return (
    <Button
      size="icon"
      className="absolute bottom-4 right-4 z-20 size-14 rounded-full shadow-lg md:hidden"
      aria-label="Start a new session"
      title="Start a new session"
      onClick={onNew}
    >
      <Plus aria-hidden="true" className="size-6" />
    </Button>
  )
}
