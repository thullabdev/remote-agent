import type { AwayMode } from '../bridge/notifier.ts'
import type { ChatLog } from './chat-log.ts'

/** Records every change of away mode in the ChatLog feed, so /away, /back and PUT /api/away all broadcast it. Returns the unbind function. */
export function bindAway(away: AwayMode, chatLog: ChatLog): () => void {
  return away.subscribe(value => {
    chatLog.recordAway(value)
  })
}
