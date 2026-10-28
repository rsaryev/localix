import type { z } from 'zod'
import type { ConfigReloadClass } from '@localixai/mini-app-sdk/backend'
import type { ToolLedger } from '../../tool-ledger'

/**
 * The host PORT of the `Configure` tool — everything it needs from the runtime, as callbacks.
 *
 * agent-core owns the tool's shape (its actions, the HITL exchange, the per-run memory of
 * declines); it owns NO configuration kind. What can be changed, how a change is described
 * to a human and how an approved change is written all live in the remedy registry
 * (`features/config-proposals`), and reach the tool through this port. Adding a kind of
 * change is a new remedy there; this file does not change.
 */

/** What `action:"inspect"` may point at. */
export type InspectTarget =
  | { kind: 'tool'; name: string }
  | { kind: 'agent'; name: string }
  | { kind: 'setting'; name: string }
  /** Everything at once: the ledger's withheld rows, the agent roster, the routing state. */
  | { kind: 'summary' }

/** The card a remedy renders for one proposed change — what the human sees and answers. */
export interface ProposalCard {
  /** Dedupe key for "already declined this run": `<remedyId>:<target>`. */
  key: string
  remedyId: string
  title: string
  detail: string
  diff: readonly string[]
  /** The agent whose rules this lands in — always the one that proposed it. */
  agentId: string
  reload: ConfigReloadClass
}

export interface ConfigureHost {
  /** The union of every remedy's change shape — embedded verbatim in the tool's input schema. */
  changeSchema: z.ZodType<unknown>
  /** Render a target in ledger vocabulary. Never re-reads policy: the ledger is the run's answer. */
  inspect(target: InspectTarget, ledger: ToolLedger | undefined): Promise<string>
  /** Validate a change and render its card, or throw an Error whose message the model can act on. */
  describe(change: unknown): Promise<ProposalCard>
  /** Write an APPROVED change. Throws on a policy conflict or a refused write. */
  apply(input: { change: unknown; proposalId: string }): Promise<{ summary: string }>
  /** Durable record of what was proposed and what the human decided — the provenance trail. */
  recordDecision(input: {
    proposalId: string
    card: ProposalCard
    status: 'approved' | 'declined' | 'applied' | 'failed' | 'expired'
    error?: string
  }): Promise<void>
}

export interface ConfigureToolOptions {
  sessionId: string
  host: ConfigureHost
  /**
   * The run's ledger, read at CALL time — the registry that builds this tool is the one that
   * computes the ledger, so the value cannot exist when the tool is constructed.
   */
  ledgerRef: { current?: ToolLedger }
  /**
   * Proposals the user declined in THIS run, by card key. A human "no" is remembered rather
   * than counted: re-proposing it is refused outright, and it never trips a mistake breaker
   * (the same stance `gate-refusal-tracker.ts` takes on a human decline).
   */
  declined: Set<string>
}
