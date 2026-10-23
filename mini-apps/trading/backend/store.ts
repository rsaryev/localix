/**
 * Persisted trading connections — a saved venue survives a restart. Configs live in a
 * per-user JSON file under `~/.localix/trading-connections/<userId>.json`.
 *
 * CREDENTIALS: the recommended shape is a `${secret:KEY}` token, resolved at use time
 * against the central write-only vault — the plaintext never lands here. A user who types a
 * raw key gets it stored as-is (a local single-user tool),
 * which is why the client-facing `TradingConnectionInfo` redacts every credential value.
 *
 * This file's header used to say it mirrored the database workbench's store — "the same
 * atomic-write + per-user write-lock + cache discipline, which is what closed its mid-write
 * read race". It was right, and that was the problem: a copy of a bug FIX, documented as a
 * copy. The discipline now has exactly one owner, `@localixai/mini-app-sdk/backend`'s
 * `user-entity-store`, and both workbenches call it. The race it closes (a reader observing a
 * half-written file) is subtle enough that a third copy would re-introduce it rather than re-derive it.
 */
import { createUserEntityStore, type UserEntityStore } from '@localixai/mini-app-sdk/backend'
import type { TradingConnectionConfig } from './contracts'
import { safeFileKey } from './store-paths'

export interface SavedTradingConnection {
  id: string
  name: string
  createdAt: number
  config: TradingConnectionConfig
}

export type TradingConnectionStore = UserEntityStore<SavedTradingConnection>

export function createTradingConnectionStore(opts: { dir: string }): TradingConnectionStore {
  // `fileKey` is the path-traversal boundary, not formatting — `userId` is the raw,
  // unauthenticated `x-user-id` header. The store requires it and does not default it.
  return createUserEntityStore<SavedTradingConnection>({ dir: opts.dir, fileKey: safeFileKey })
}
