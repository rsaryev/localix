/**
 * Capabilities on the change feed. Every capability mutation passes the capability revision
 * (`revision.ts`) — skills, plugins, MCP servers, agents — and most cannot name what changed
 * (files edited, a plugin installing several), so a bump announces `resync` for every capability
 * kind, once a burst has settled. Consumers reconcile; unchanged items cost them nothing.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { recordCoreChanges, type CoreRefs } from '../changes/core-entities'
import type { EntityKind } from '@localixai/change-feed'
import { createDebouncer } from '../../lib/debounce'
import { onCapabilityRevision } from './revision'

/** The core registry's capability kinds. */
export const CAPABILITY_KINDS = [
  'skill',
  'plugin',
  'mcp',
  'agent',
] as const satisfies readonly EntityKind<CoreRefs>[]

const SETTLE_MS = 500

/** Announce capability changes on the feed until the returned stop. */
export function announceCapabilityChanges(db: Kysely<AppDatabase>): () => void {
  const settle = createDebouncer(SETTLE_MS)
  const off = onCapabilityRevision(() =>
    settle.schedule(
      () =>
        void recordCoreChanges(
          db,
          CAPABILITY_KINDS.map((entity) => ({ entity, op: 'resync' as const })),
        ),
    ),
  )
  return () => {
    off()
    settle.cancel()
  }
}
