/**
 * THE RELAY — the projector from core notices to client topics (P11: clients are poked, then
 * pull). A notice names what changed; the relay names the read models it invalidates and pokes
 * every surface of the user with `resources.changed`. The client re-reads from the owner.
 *
 * Each kind says its topics here, or why it has none: `satisfies` keeps the map whole, so a kind
 * added to the registry fails to compile until the relay answers for it. Every owner of a client
 * topic announces each of its changes, so the relay is the only path from a write to a poke.
 */
import type { ConsumerHandlers, EntityKind } from '@localixai/change-feed'

import { capabilitiesChanged } from '../capabilities/revision'
import type { CoreCascades, CoreRefs } from '../changes/core-entities'
import type { RealtimeResource } from './resources'

interface Topics {
  resources: readonly RealtimeResource[]
  /** The capability revision moves too (a rule write has already moved it itself). */
  bumpsCapabilities?: boolean
  /** What a `resync` of the kind invalidates, when less than a named change does. */
  resync?: readonly RealtimeResource[]
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
  // A project's scope or settings: the project list, what the catalog offers in it, and its chats
  // (their model and route defaults come from its settings).
  project: { resources: ['projects', 'capabilities', 'sessions'], bumpsCapabilities: true },
  'project.settings': {
    resources: ['projects', 'capabilities', 'sessions'],
    bumpsCapabilities: true,
  },
  'user.profile': { resources: ['profile'] },
  // Agent settings route runs and pick per-agent models: chats show both.
  'user.agent-settings': {
    resources: ['profile', 'capabilities', 'sessions'],
    bumpsCapabilities: true,
  },
  'user.view-state': { resources: ['view-state'] },
  secret: { resources: ['vault'] },
  'system.toggle': { resources: ['system'] },
  // File-owned capabilities: their writers bump the revision as they write (so the relay never
  // does — a bump announces `resync` for every capability kind), and the announcements poke.
  // An agent's own change reaches its chats too; plugins and MCP servers poke as they converge.
  agent: { resources: ['capabilities', 'sessions'], resync: ['capabilities'] },
  skill: { resources: ['capabilities'] },
  plugin: 'ignore',
  mcp: 'ignore',
  // What the `local` provider lists reaches clients through the catalog's own refresh; the
  // install itself through the `local-models` status poke (`status-pokes.ts`), which every
  // install and removal also signals.
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
        : (change: { op: string; ref?: { userId?: unknown } }) => {
            if (topics.bumpsCapabilities) capabilitiesChanged()
            const userId = change.ref?.userId
            const resources =
              change.op === 'resync' ? (topics.resync ?? topics.resources) : topics.resources
            deps.publish(typeof userId === 'string' ? userId : deps.defaultUserId, [...resources])
          }
  }
  return { handlers: handlers as ConsumerHandlers<CoreRefs, CoreCascades> }
}
