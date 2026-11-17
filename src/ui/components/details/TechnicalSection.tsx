import { Check, Copy } from 'lucide-react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { Button } from '../ui/button.tsx'
import { SectionLabel } from './SectionLabel.tsx'
import { useCopy } from './use-copy.ts'

/** The working directory and the command that attaches to the session's terminal. Hidden when neither is known. */
export function TechnicalSection({ chat, onNotify }: { chat: Chat; onNotify(message: string): void }) {
  const { copied, copy } = useCopy(onNotify)
  const tmuxCommand = chat.tmuxName === null ? null : `tmux attach -t ${chat.tmuxName}`
  if (chat.cwd === null && tmuxCommand === null) {
    return null
  }
  return (
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
  )
}
