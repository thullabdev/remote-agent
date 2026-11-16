import { useState } from 'react'
import type { Chat, ForkView, PinView } from '../../../channel/web/protocol.ts'
import { RenameDialog } from '../rename-dialog.tsx'
import { BookmarksSection } from './BookmarksSection.tsx'
import { ConfirmActionDialog } from './ConfirmActionDialog.tsx'
import { ForksSection } from './ForksSection.tsx'
import { ManageSection } from './ManageSection.tsx'
import { SessionActions } from './SessionActions.tsx'
import { SessionSummary } from './SessionSummary.tsx'
import { TechnicalSection } from './TechnicalSection.tsx'
import type { ChatInfoProps, ConfirmAction } from './types.ts'

type SessionDetailsProps = Pick<
  ChatInfoProps,
  'chat' | 'model' | 'onNotify' | 'onEnd' | 'onArchive' | 'onUnarchive' | 'onRename' | 'onPin' | 'onClear' | 'onFork' | 'onResume' | 'pins' | 'onUnpin' | 'onJump' | 'onRefreshForks' | 'onShowFork' | 'onOpenFork'
> & { forks: ForkView[] }

/**
 * The session's details: summary, actions, bookmarks, forks, technical facts and manage. It owns the two dialogs that these open
 * (rename, and the confirmed end or clear).
 */
export function SessionDetails({
  chat,
  model,
  forks,
  pins,
  onNotify,
  onEnd,
  onArchive,
  onUnarchive,
  onRename,
  onPin,
  onClear,
  onFork,
  onResume,
  onUnpin,
  onJump,
  onRefreshForks,
  onShowFork,
  onOpenFork,
}: SessionDetailsProps) {
  const isGeneral = chat.id === 'general'
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [renaming, setRenaming] = useState(false)

  const runConfirmed = async () => {
    const action = confirm
    setConfirm(null)
    if (action === 'end') {
      await onEnd()
    } else if (action === 'clear') {
      await onClear()
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <SessionSummary chat={chat} model={model ?? null} />
        {!isGeneral && <SessionActions chat={chat} onResume={onResume} onFork={onFork} onPin={onPin} onRequestRename={() => setRenaming(true)} />}
        <BookmarksSection pins={pins} onJump={onJump} onUnpin={onUnpin} />
        <ForksSection
          forks={forks}
          onRefresh={() => onRefreshForks?.()}
          onShowFork={fork => onShowFork?.(fork)}
          onOpenFork={chatId => onOpenFork?.(chatId)}
        />
        <TechnicalSection chat={chat} onNotify={onNotify} />
        <ManageSection chat={chat} onRequestConfirm={setConfirm} onArchive={onArchive} onUnarchive={onUnarchive} />
      </div>
      <RenameDialog open={renaming} title={chat.title} onClose={() => setRenaming(false)} onRename={onRename} />
      <ConfirmActionDialog action={confirm} onCancel={() => setConfirm(null)} onConfirm={() => void runConfirmed()} />
    </>
  )
}
