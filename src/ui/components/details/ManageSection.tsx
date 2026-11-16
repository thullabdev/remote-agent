import { AlertTriangle, Archive, ArchiveRestore, EyeOff } from 'lucide-react'
import type { Chat } from '../../../channel/web/protocol.ts'
import { Button } from '../ui/button.tsx'
import { SectionLabel } from './SectionLabel.tsx'
import type { ConfirmAction } from './types.ts'

type ManageSectionProps = {
  chat: Chat
  onRequestConfirm(action: ConfirmAction): void
  onArchive(): Promise<void>
  onUnarchive(): Promise<void>
}

/** Ending, archiving and hiding history. Ending and hiding ask first; the others run at once. */
export function ManageSection({ chat, onRequestConfirm, onArchive, onUnarchive }: ManageSectionProps) {
  const isGeneral = chat.id === 'general'
  const ended = chat.status === 'ended'
  return (
    <section aria-label="Manage" className="space-y-2 border-t border-border/60 pt-4">
      <SectionLabel>Manage</SectionLabel>
      <div className="grid gap-2">
        {chat.spawned && chat.status === 'active' && (
          <Button variant="outline" className="justify-start" onClick={() => onRequestConfirm('end')}>
            <AlertTriangle className="text-amber-700 dark:text-amber-300" aria-hidden="true" />
            End Spawned Session
          </Button>
        )}
        {!isGeneral && ended && !chat.archived && (
          <Button variant="outline" className="justify-start" onClick={() => void onArchive()}>
            <Archive aria-hidden="true" />
            Archive
          </Button>
        )}
        {!isGeneral && chat.archived && (
          <Button variant="outline" className="justify-start" onClick={() => void onUnarchive()}>
            <ArchiveRestore aria-hidden="true" />
            Restore from Archived
          </Button>
        )}
        <Button variant="outline" className="justify-start text-red-700 hover:text-red-800 dark:text-red-300" onClick={() => onRequestConfirm('clear')}>
          <EyeOff aria-hidden="true" />
          Hide history on all devices
        </Button>
      </div>
    </section>
  )
}
