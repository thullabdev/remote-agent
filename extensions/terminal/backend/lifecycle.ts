import type { SessionDoc, SessionRepository } from './sessions.ts'

/** A detached session is reaped once nobody has attached or detached it for this long. */
export const IDLE_AFTER_MS = 12 * 60 * 60 * 1000
export const IDLE_CHECK_MS = 60 * 1000

export type LifecycleDeps = {
  owner: string
  repo: SessionRepository
  /** Whether the tmux session still exists. */
  alive(name: string): Promise<boolean>
  kill(name: string): Promise<void>
  /** Whether a browser is attached to the session right now. */
  isAttached(sid: string): boolean
  now(): number
  log(message: string): void
}

/**
 * On start: a stored open session whose tmux session is gone is closed as `missing`. Sessions whose tmux session survived,
 * including through a bridge restart, stay open with their clocks unchanged. Returns how many were closed.
 */
export async function reconcile(deps: LifecycleDeps): Promise<number> {
  let closed = 0
  for (const doc of deps.repo.listOpen(deps.owner)) {
    if (!(await deps.alive(doc.tmuxName))) {
      deps.repo.close(doc.sid, 'missing')
      deps.log(`terminal ${doc.sid} closed: its tmux session is gone`)
      closed += 1
    }
  }
  return closed
}

/**
 * Kills detached sessions idle for `IDLE_AFTER_MS`. The clock starts at the last attach or detach, or at creation for a
 * session never attached, so a restart neither extends nor drops it. Attached sessions are never reaped.
 */
export async function sweepIdle(deps: LifecycleDeps, idleAfterMs = IDLE_AFTER_MS): Promise<number> {
  let reaped = 0
  const cutoff = deps.now() - idleAfterMs
  for (const doc of deps.repo.listOpen(deps.owner)) {
    if (deps.isAttached(doc.sid) || baselineOf(doc) > cutoff) {
      continue
    }
    await deps.kill(doc.tmuxName)
    deps.repo.close(doc.sid, 'idle')
    deps.log(`terminal ${doc.sid} reaped after being idle`)
    reaped += 1
  }
  return reaped
}

function baselineOf(doc: SessionDoc): number {
  return doc.lastAttachedAt ?? doc.createdAt
}
