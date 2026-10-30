/**
 * The core's entity kinds and what a change notice says about each: the one registry every core
 * producer writes to and every core consumer (semantic index, realtime, …) answers for in full.
 *
 * A ref names an entity and where it lives, never its content: `userId` (whose it is) and, for a
 * capability, its scope — `global`, or the project it belongs to. Capabilities owned by files
 * (skills, agents, plugins) can change outside the app; their owners announce `resync`, and
 * consumers reconcile the kind.
 */
import type { Kysely, Transaction } from 'kysely'
import { z } from 'zod'
import {
  createChangeFeed,
  recordChanges,
  type Change,
  type EntityRegistry,
} from '@localixai/change-feed'
import type { AppDatabase } from '../../db/types'
import { changeRetryDelayMs } from './retry'

/** Where a capability lives: `global`, or the project it belongs to. */
const scope = z.string().min(1)

export const CORE_REFS = {
  'chat.session': z.object({ id: z.string(), userId: z.string() }),
  'chat.message': z.object({ id: z.string(), userId: z.string(), sessionId: z.string() }),
  skill: z.object({ name: z.string(), scope }),
  plugin: z.object({ id: z.string(), scope }),
  // A mini app installed, updated, removed or its settings changed (`id` is its name).
  'mini-app': z.object({ id: z.string(), scope }),
  // A mini app marketplace added or removed, or what is kept to judge its signatures (`url`).
  'mini-app.marketplace': z.object({ url: z.string() }),
  // Whether an installed mini app updates on its own was switched (`id` is its name).
  'mini-app.updates': z.object({ id: z.string() }),
  // `id` is the server's name (its catalog key); `serverId` its record id, on a deletion.
  mcp: z.object({ id: z.string(), scope, serverId: z.string().optional() }),
  // `id` is the agent's catalog key (its handle); `agentId` its stable id, when the owner knows it.
  agent: z.object({ id: z.string(), scope, agentId: z.string().optional() }),
  // One agent's rule list, replaced as a whole (its key: the agent it belongs to).
  'capability.rule': z.object({ userId: z.string(), agentId: z.string() }),
  // A project: created, moved, renamed, deleted or restored.
  project: z.object({ id: z.string(), userId: z.string() }),
  // A project's settings (its model, route, instructions…), written without a scope change.
  'project.settings': z.object({ id: z.string(), userId: z.string() }),
  // A person's profile: its interface settings…
  'user.profile': z.object({ userId: z.string() }),
  // …and its agent settings (model routing, per-agent models), which change what runs resolve.
  'user.agent-settings': z.object({ userId: z.string() }),
  // One saved piece of a person's view state (a draft, the open chat), by its kind and key.
  'user.view-state': z.object({ userId: z.string(), kind: z.string(), key: z.string() }),
  // A vault item: created, rotated, its metadata changed, or removed (by its key).
  secret: z.object({ userId: z.string(), key: z.string() }),
  // A host control (keep-awake…) switched on or off.
  'system.toggle': z.object({ id: z.string() }),
  // A model installed on this computer (the `local` provider), by its id.
  'local.model': z.object({ id: z.string() }),
  // A provider account: created, signed in, a key enabled, or deleted.
  'provider.connection': z.object({ id: z.string(), userId: z.string(), providerId: z.string() }),
}

export const CORE_CASCADES = {
  // A chat's deletion takes its messages (`deleteSession` removes the whole subtree).
  'chat.session': ['chat.message'],
} as const satisfies Partial<Record<keyof typeof CORE_REFS, readonly (keyof typeof CORE_REFS)[]>>

export const CORE_ENTITIES: EntityRegistry<typeof CORE_REFS, typeof CORE_CASCADES> = {
  refs: CORE_REFS,
  cascades: CORE_CASCADES,
}

export type CoreRefs = typeof CORE_REFS
export type CoreCascades = typeof CORE_CASCADES
export type CoreChange = Change<CoreRefs>

/** The core registry's stream. */
export const CORE_STREAM = 'core'

/** Record core changes in the producer's transaction. Never throws (`@localixai/change-feed`). */
export function recordCoreChanges(
  writer: Kysely<AppDatabase> | Transaction<AppDatabase>,
  changes: CoreChange | readonly CoreChange[],
): Promise<void> {
  return recordChanges<CoreRefs, AppDatabase>(writer, CORE_STREAM, changes)
}

/** The core stream's consumers (one per process, made by bootstrap). */
export function createCoreChangeFeed(
  db: Kysely<AppDatabase>,
  log?: (event: string, detail: Record<string, unknown>) => void,
) {
  return createChangeFeed({
    db,
    stream: CORE_STREAM,
    registry: CORE_ENTITIES,
    retryDelayMs: changeRetryDelayMs,
    log,
  })
}

export type CoreChangeFeed = ReturnType<typeof createCoreChangeFeed>
