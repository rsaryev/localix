/**
 * Host wiring for the `Configure` tool.
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
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { ConfigureHost } from '../../../agent-core/tools/configure/configure-contracts'
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
  /** Claude Code ConfigChange hooks see an approved change before it is written. */
  ccHooks?: CcHooksRuntime
}): OptionalToolPorts[typeof TOOL.Configure] {
  const { deps, userId, session, agentProfile, ledgerRef } = input
  if (!isToolDirect(agentProfile, TOOL.Configure)) return undefined
  if (!deps.configProposals) return undefined
  return {
    sessionId: session.id,
    host: withConfigChangeHooks(
      deps.configProposals.hostFor({
        userId,
        sessionId: session.id,
        projectId: session.projectId ?? null,
        agentId: input.agentId,
      }),
      input.ccHooks,
      session.projectId ? 'project_settings' : 'user_settings',
    ),
    ledgerRef,
    // Per RUN, deliberately: a decline is a fact about this conversation, and the next run
    // of the same session starts with a clean slate the way every other per-run guard does.
    declined: new Set<string>(),
  }
}

/**
 * CC ConfigChange on the one configuration write a run makes itself: an approved `configure`
 * proposal. The hooks run before the write (`source` is the scope the agent's rules live in), and
 * a block keeps the change from applying — the tool reports the refusal like any refused write.
 */
export function withConfigChangeHooks(
  host: ConfigureHost,
  ccHooks: CcHooksRuntime | undefined,
  source: 'project_settings' | 'user_settings',
): ConfigureHost {
  if (!ccHooks?.hasHooks('ConfigChange')) return host
  return {
    ...host,
    async apply(input) {
      const verdict = await ccHooks.runConfigChange(source)
      if (verdict.blocked) throw new Error('A ConfigChange hook blocked this configuration change.')
      return host.apply(input)
    },
  }
}
