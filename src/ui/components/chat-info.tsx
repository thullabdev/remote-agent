import { DetailsPanel } from './details/DetailsPanel.tsx'
import { SessionDetails } from './details/SessionDetails.tsx'
import { SubagentActivity } from './details/SubagentActivity.tsx'
import type { ChatInfoProps } from './details/types.ts'

export type { ChatInfoProps, SubagentApi } from './details/types.ts'

/**
 * The right-hand panel for a chat. It shows the session's details, or a sub-agent's activity when one is open. The panel itself is
 * in `details/DetailsPanel.tsx`; the parts are in `details/`.
 */
export function ChatInfo({ chat, onClose, api, subagent, onCloseSubagent, onOpenSubagent, onNotify, onEnd, onArchive, onUnarchive, onRename, onPin, onClear, onFork, onResume, pins, onUnpin, onJump, forks = [], onRefreshForks, onShowFork, onOpenFork, model = null, openPanel, density }: ChatInfoProps) {
  return (
    <DetailsPanel title={subagent?.title ?? 'Session details'} onBack={subagent !== null ? onCloseSubagent : undefined} onClose={onClose}>
      {subagent !== null ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <SubagentActivity key={`${subagent.chatId}:${subagent.agentId}`} api={api} chatId={subagent.chatId} agentId={subagent.agentId} onOpenSubagent={onOpenSubagent} />
        </div>
      ) : (
        <SessionDetails
          chat={chat}
          model={model}
          forks={forks}
          pins={pins}
          onNotify={onNotify}
          onEnd={onEnd}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onRename={onRename}
          onPin={onPin}
          onClear={onClear}
          onFork={onFork}
          onResume={onResume}
          onUnpin={onUnpin}
          onJump={onJump}
          onRefreshForks={onRefreshForks}
          onShowFork={onShowFork}
          onOpenFork={onOpenFork}
          openPanel={openPanel}
          density={density}
        />
      )}
    </DetailsPanel>
  )
}
