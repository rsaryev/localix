/**
 * THE USAGE LEDGER, as a projector on the core change feed.
 *
 * A chat turn's ledger row is derived from its assistant message (`ledger-rows.ts`, written by `ledger-repository.ts`): its usage,
 * timing and the routing the run stamped on it (`payload.turnEnd`). The run used to write the
 * row itself, fire-and-forget after the message committed, and a boot pass repaired the crash
 * window between the two. The message's notice is recorded in the message's own transaction, so
 * there is no such window: a turn's usage moving announces the message, and this projector
 * writes its row. A run's end announces its chat, and the chat's rows that disagree with their
 * messages are rewritten.
 *
 * Idempotent: a duplicate notice rewrites the same row. Its reconcile is the full scan the boot
 * repair did, in frame-sized pages. Rows of deleted chats stay: spend already happened. The
 * auxiliary rows (titles, completions) are not derived from messages and are not touched.
 */
import type { ConsumerHandlers } from '@localixai/change-feed'

import type { CoreCascades, CoreRefs } from '../changes/core-entities'
import { reconcileUsageInSlices } from './reconcile-slices'
import type { UsageRepository } from './repository'

export function createUsageLedgerProjector(deps: {
  usage: Pick<UsageRepository, 'projectMessages' | 'reconcileAssistantMessagePage'>
}) {
  const handlers: ConsumerHandlers<CoreRefs, CoreCascades> = {
    'chat.message': async (change) => {
      if (change.op === 'upserted')
        await deps.usage.projectMessages({ messageIds: [change.ref.id] })
    },
    'chat.session': async (change) => {
      if (change.op === 'upserted')
        await deps.usage.projectMessages({ sessionIds: [change.ref.id] })
    },
    skill: 'ignore',
    plugin: 'ignore',
    mcp: 'ignore',
    agent: 'ignore',
    'capability.rule': 'ignore',
    project: 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  }

  const reconcile = () =>
    reconcileUsageInSlices(deps.usage, {
      yield: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    }).then(() => undefined)

  return { handlers, reconcile }
}
