import type { z } from 'zod'
import type { ProposalCard } from '../agent-core/tools/configure/configure-contracts'
import type { Rule, RuleOrigin } from '../capabilities/rule'
import type { RuleChange } from '../capabilities/rule-changes'
import type { AgentSummary } from '../agents/contracts'

export type { ProposalCard }

/**
 * A REMEDY: one kind of configuration change the agent may propose, owned by the feature
 * whose data it writes.
 *
 * The `configure` tool knows none of these. It embeds the union of their `schema`s in its
 * input, shows the card `describe` renders, and after the user's click calls `apply`. Adding
 * a kind of change is a new file in `remedies/` and one line in the registry — the tool, the
 * HITL contract and the UI card do not change. That is the whole point of the split: the
 * model-facing surface stays one small schema while the set of things it can ask for grows.
 *
 * Every `apply` delegates to an EXISTING write path (the capability apply service, the rule
 * repository's `mutate`). A remedy is a translation, never a second writer of anyone's table.
 */
export interface Remedy<TChange extends { kind: string } = { kind: string }> {
  id: string
  schema: z.ZodType<TChange>
  describe(ctx: RemedyContext, change: TChange): Promise<ProposalCard>
  /** Writes to `ctx.agentId` — there is no second place a change could land. */
  apply(ctx: RemedyContext, change: TChange): Promise<{ summary: string }>
}

/** Everything a remedy may need to look at or write, bound to the proposing run. */
export interface RemedyContext {
  userId: string
  sessionId: string
  /**
   * The agent that proposed the change — and the ONE list an approved proposal writes to.
   *
   * A remedy used to pick a scope: the session's project, or `global`, or the scope the
   * ledger's denial named. There is no ladder any more, and the right answer was always this
   * one anyway: the agent that ran into the limit is the agent whose rules should change.
   */
  agentId: string
  /**
   * The proposing session's project. NOT where rules go — that is `agentId` — but where an
   * agent RECORD is stored, which is the one thing a project still decides.
   */
  projectId: string | null
  /** Stamped on every rule an approved proposal writes. */
  origin: () => RuleOrigin
  ports: RemedyPorts
}

/** The write paths, as ports — composed at the bootstrap root, never imported by a remedy. */
export interface RemedyPorts {
  rules: {
    readSnapshot(userId: string, agentId: string): Promise<{ revision: number; rules: Rule[] }>
    mutate(
      userId: string,
      agentId: string,
      change: (rules: Rule[]) => readonly Rule[],
    ): Promise<void>
  }
  /**
   * The one write path for capability policy, in its own vocabulary.
   *
   * A remedy that switches a plugin or an MCP server on goes through here rather than
   * writing the row itself, because those kinds carry consequences the rule alone does not:
   * a dependency cascade, an inspection cache, a live host to re-wire. Rules the remedy owns
   * outright (an agent's tool list) are written through `rules` instead, so they can carry
   * the `origin` that says which session proposed them.
   */
  capabilities: {
    apply(
      userId: string,
      input: {
        agentId: string
        changes: ReadonlyArray<RuleChange>
      },
    ): Promise<unknown>
  }
  /**
   * READ-ONLY, because nothing here authors an agent any more. The roster and one role's
   * detail are what `inspect` reports as context; creating, updating, duplicating and
   * deleting a record are the Agents screen's, and were removed from this surface with the
   * remedies that used to call them.
   */
  agents: {
    listAgents(userId: string, opts?: { projectId?: string | null }): Promise<AgentSummary[]>
    getAgent(userId: string, name: string, projectId?: string | null): Promise<AgentSummary | null>
  }
  /** Read-only for the same reason: `inspect` reports the routes, Settings chooses them. */
  user: {
    getAgentSettings(userId: string): Promise<Record<string, unknown> | null>
  }
  /** Bump the process-wide capability revision after a direct rule write. */
  bumpCapabilityRevision(): void
}
