/**
 * THE RELAY — the projector from core notices to client topics (P11: clients are poked, then
 * pull). A notice names what changed; the relay names the read models it invalidates and pokes
 * every surface of the user with `resources.changed`. The client re-reads from the owner.
 *
 * Each kind says its topics here, or why it has none: `satisfies` keeps the map whole, so a kind
 * added to the registry fails to compile until the relay answers for it. Entities whose owners
 * do not announce every change yet keep their mutation wrappers in `bootstrap/resource-sync.ts`.
 */
import type { ConsumerHandlers, EntityKind } from '@localixai/change-feed'

import { capabilitiesChanged } from '../capabilities/revision'
import type { CoreCascades, CoreRefs } from '../changes/core-entities'
import type { RealtimeResource } from './resources'

interface Topics {
  resources: readonly RealtimeResource[]
  /** The capability revision moves too (a rule write has already moved it itself). */
  bumpsCapabilities?: boolean
}

export const RELAY_TOPICS = {
  // A connection created, signed in, renamed, its keys changed, or deleted: the provider list,
  // what the catalog offers, the vault (keys live there) and chats whose routes it served.
  'provider.connection': {
    resources: ['providers', 'capabilities', 'vault', 'sessions'],
    bumpsCapabilities: true,
  },
  // An agent's rule list: the capability snapshot. The repository bumped the revision.
  'capability.rule': { resources: ['capabilities'] },
  // Chats and messages reach clients through the session event stream, not topics.
  'chat.session': 'ignore',
  'chat.message': 'ignore',
  // A project announces only scope changes; its settings writes are relayed by its wrapper.
  project: 'ignore',
  // File-owned capabilities announce `resync` after the revision bump their writer made, and
  // their writers poke clients as they bump.
  skill: 'ignore',
  plugin: 'ignore',
  mcp: 'ignore',
  agent: 'ignore',
  // What the `local` provider lists reaches clients through the catalog's own refresh.
  'local.model': 'ignore',
} as const satisfies Record<EntityKind<CoreRefs>, Topics | 'ignore'>

export function createRelay(deps: {
  defaultUserId: string
  publish(userId: string, resources: RealtimeResource[]): void
}) {
  const handlers: Record<string, unknown> = {}
  for (const [kind, topics] of Object.entries(RELAY_TOPICS) as [string, Topics | 'ignore'][]) {
    handlers[kind] =
      topics === 'ignore'
        ? 'ignore'
        : (change: { ref?: { userId?: unknown } }) => {
            if (topics.bumpsCapabilities) capabilitiesChanged()
            const userId = change.ref?.userId
            deps.publish(typeof userId === 'string' ? userId : deps.defaultUserId, [
              ...topics.resources,
            ])
          }
  }
  return { handlers: handlers as ConsumerHandlers<CoreRefs, CoreCascades> }
}
