import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { ConfigureHost } from '../agent-core/tools/configure/configure-contracts'
import type { RemedyContext, RemedyPorts } from './contracts'
import { renderInspection } from './inspect'
import { createRemedyRegistry, type RemedyRegistry } from './registry'

/**
 * The `Configure` tool's HOST, composed once per process and bound per run.
 *
 * Owns the proposals table (the durable trail of what the agent asked and what the human
 * decided) and hands the tool a `ConfigureHost` whose every method is a remedy-registry
 * call in the run's context. The tool sees callbacks; the registry sees ports; nobody sees
 * a repository they do not own.
 */
export interface ConfigProposalService {
  hostFor(run: {
    userId: string
    sessionId: string
    projectId: string | null
    /** Whose rules an approved proposal writes to — the agent taking this turn. */
    agentId: string
  }): ConfigureHost
}

export function createConfigProposalService(deps: {
  db: Kysely<AppDatabase>
  ports: RemedyPorts
  registry?: RemedyRegistry
  now?: () => string
}): ConfigProposalService {
  const registry = deps.registry ?? createRemedyRegistry()
  const now = deps.now ?? (() => new Date().toISOString())

  return {
    hostFor(run) {
      const ctx = (proposalId: string): RemedyContext => ({
        userId: run.userId,
        sessionId: run.sessionId,
        projectId: run.projectId,
        agentId: run.agentId,
        origin: () => ({
          kind: 'agent-proposal',
          sessionId: run.sessionId,
          proposalId,
          at: now(),
        }),
        ports: deps.ports,
      })
      // `describe` runs before a proposal id exists; its context never writes.
      const readCtx = ctx('')
      return {
        changeSchema: registry.changeSchema,
        inspect: (target, ledger) => renderInspection(readCtx, target, ledger),
        describe: (change) => registry.describe(readCtx, change),
        async apply({ change, proposalId }) {
          // The agent may have been deleted while the card waited; its rules were purged with it,
          // and a write now would bring a rule list back for an agent that no longer exists.
          if (!(await deps.ports.agents.getAgent(run.userId, run.agentId, run.projectId)))
            throw new Error('The agent that proposed this no longer exists.')
          return registry.apply(ctx(proposalId), change)
        },
        async recordDecision({ proposalId, card, status, error }) {
          // One row per proposal, status overwritten as it advances: approved → applied|failed.
          await deps.db
            .insertInto('config_proposals')
            .values({
              id: proposalId,
              user_id: run.userId,
              session_id: run.sessionId,
              remedy_id: card.remedyId,
              title: card.title,
              change_json: JSON.stringify({ key: card.key, diff: card.diff }),
              agent_id: card.agentId,
              status,
              error: error ?? null,
              created_at: now(),
              decided_at: now(),
            })
            .onConflict((conflict) =>
              // `agent_id` is not re-set: a proposal's target cannot change between the
              // approval and the write, and a row that said otherwise would be a lie about
              // which list was touched.
              conflict.column('id').doUpdateSet({
                status,
                error: error ?? null,
                decided_at: now(),
              }),
            )
            .execute()
        },
      }
    },
  }
}
