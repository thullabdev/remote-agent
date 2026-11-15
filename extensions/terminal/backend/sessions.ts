import { basename } from 'node:path'
import type { ExtensionStorage } from '../../../src/extension-sdk/storage.ts'

export type CloseReason = 'user' | 'idle' | 'exited' | 'missing'

/** One terminal session as stored. `launchCwd` is set at creation and never changes. */
export type SessionDoc = {
  sid: string
  owner: string
  launchCwd: string
  project: string
  chatId: string | null
  tmuxName: string
  createdAt: number
  lastAttachedAt: number | null
  closedAt: number | null
  closeReason: CloseReason | null
}

export type SessionRepository = {
  create(input: { sid: string; owner: string; launchCwd: string; chatId: string | null; tmuxName: string }): SessionDoc
  get(sid: string): SessionDoc | undefined
  /** Open sessions for an owner, newest first. */
  listOpen(owner: string): SessionDoc[]
  /** The newest open session for an owner in a folder. */
  findOpenByFolder(owner: string, launchCwd: string): SessionDoc | undefined
  countOpen(owner: string): number
  touch(sid: string, at: number): void
  /** Marks a session closed. Idempotent: the first close and its reason are kept. */
  close(sid: string, reason: CloseReason): SessionDoc | undefined
}

/** The project a folder belongs to, for grouping: its last path segment. */
export function projectOf(launchCwd: string): string {
  return basename(launchCwd) || launchCwd
}

export function createSessionRepository(storage: ExtensionStorage, now: () => number): SessionRepository {
  const collection = storage.collection('sessions')

  function indexedOf(doc: SessionDoc) {
    return {
      owner: doc.owner,
      launchCwd: doc.launchCwd,
      project: doc.project,
      chatId: doc.chatId,
      closedAt: doc.closedAt,
    }
  }

  function save(doc: SessionDoc): void {
    collection.upsert(doc.sid, doc, indexedOf(doc))
  }

  function newestFirst(docs: SessionDoc[]): SessionDoc[] {
    return docs.sort((a, b) => b.createdAt - a.createdAt)
  }

  return {
    create(input) {
      const doc: SessionDoc = {
        sid: input.sid,
        owner: input.owner,
        launchCwd: input.launchCwd,
        project: projectOf(input.launchCwd),
        chatId: input.chatId,
        tmuxName: input.tmuxName,
        createdAt: now(),
        lastAttachedAt: null,
        closedAt: null,
        closeReason: null,
      }
      collection.insert(doc.sid, doc, indexedOf(doc))
      return doc
    },

    get(sid) {
      return collection.get<SessionDoc>(sid)
    },

    listOpen(owner) {
      return newestFirst(collection.query<SessionDoc>({ where: { owner, closedAt: null }, limit: 1000 }).map(row => row.doc))
    },

    findOpenByFolder(owner, launchCwd) {
      return newestFirst(collection.query<SessionDoc>({ where: { owner, launchCwd, closedAt: null }, limit: 1000 }).map(row => row.doc))[0]
    },

    countOpen(owner) {
      return collection.query({ where: { owner, closedAt: null }, limit: 1000 }).length
    },

    touch(sid, at) {
      const doc = collection.get<SessionDoc>(sid)
      if (doc !== undefined && doc.closedAt === null) {
        save({ ...doc, lastAttachedAt: at })
      }
    },

    close(sid, reason) {
      const doc = collection.get<SessionDoc>(sid)
      if (doc === undefined) {
        return undefined
      }
      if (doc.closedAt !== null) {
        return doc
      }
      const closed: SessionDoc = { ...doc, closedAt: now(), closeReason: reason }
      save(closed)
      return closed
    },
  }
}
