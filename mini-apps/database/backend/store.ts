/**
 * Persisted database connections — so a saved connection survives a restart. Configs
 * (including URLs with credentials) live in a per-user JSON file under
 * `~/.localix/db-connections/<userId>.json`, mirroring how the table store roots
 * beside the db. This is a local, single-user tool; connections are stored as-is.
 * The live driver itself is never persisted — only enough to
 * reconnect on demand.
 *
 * The cache + per-user write-lock + atomic temp-and-rename discipline this store needs is
 * NOT written here: it is `@localixai/mini-app-sdk/backend`'s `user-entity-store`, the one owner. This file used
 * to hold its own copy, and so did the trading workbench — whose header said out loud that it
 * mirrors "the same atomic-write + per-user write-lock + cache discipline, WHICH IS WHAT
 * CLOSED ITS MID-WRITE READ RACE". A copy of a bug FIX, documented as a copy: the race
 * (`reconnect` intermittently 404ing with `connection_not_found` because a reader observed a
 * half-written file) is subtle enough that nobody would re-derive it on the third copy — they
 * would simply re-introduce it. Now there is one copy, and it is tested where it lives.
 */
import { createUserEntityStore, type UserEntityStore } from '@localixai/mini-app-sdk/backend'
import { safeFileKey } from '@localixai/mini-app-sdk/backend'
import type { DbConnectionConfig } from './contracts'

export interface SavedConnection {
  id: string
  name: string
  createdAt: number
  config: DbConnectionConfig
}

export type ConnectionStore = UserEntityStore<SavedConnection>

export function createConnectionStore(opts: { dir: string }): ConnectionStore {
  // `fileKey` is the path-traversal boundary, not formatting — `userId` is the raw,
  // unauthenticated `x-user-id` header. The store requires it and does not default it.
  return createUserEntityStore<SavedConnection>({ dir: opts.dir, fileKey: safeFileKey })
}
