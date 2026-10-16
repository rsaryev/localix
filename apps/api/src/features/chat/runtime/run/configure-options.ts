/**
 * Host wiring for the `configure` tool.
 *
 * The only policy here is structural and lives in the catalog: `configure` is `never` for a
 * sub-agent or an automation run, so `isToolDirect` is false there and the port is not built.
 * Everything the tool does with a proposal is the config-proposals feature's, reached through
 * `deps.configProposals` — absent in a host that did not compose it (tests), and then the
 * ledger records the gap as `authority: config.proposals`.
 */
import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { ToolLedger } from '../../../agent-core/tool-ledger'
import type { SessionRecord } from '../../repository'
import type { RunnerDeps } from '../agent-runner-types'

export function buildConfigureOptions(input: {
  deps: RunnerDeps
  userId: string
  session: SessionRecord
  /** The agent taking this turn — whose rules an approved proposal changes. */
  agentId: string
  agentProfile: RunProfile
  ledgerRef: { current?: ToolLedger }
}): OptionalToolPorts['configure'] {
  const { deps, userId, session, agentProfile, ledgerRef } = input
  if (!isToolDirect(agentProfile, TOOL.configure)) return undefined
  if (!deps.configProposals) return undefined
  return {
    sessionId: session.id,
    host: deps.configProposals.hostFor({
      userId,
      sessionId: session.id,
      projectId: session.projectId ?? null,
      agentId: input.agentId,
    }),
    ledgerRef,
    // Per RUN, deliberately: a decline is a fact about this conversation, and the next run
    // of the same session starts with a clean slate the way every other per-run guard does.
    declined: new Set<string>(),
  }
}
