import { agentHooksRun } from '../../../plugins/kit'
import type { SessionRecord } from '../../repository'
import type { ScopedCcHooks } from '../run-contract'

/** What a run needs of the agent it runs as to find its frontmatter hooks. */
export interface HookedAgent {
  source?: string
  hooks?: unknown
}

/**
 * The hooks in a delegated agent's frontmatter, as run-scoped hooks of the child's runs: active
 * while that subagent runs and gone with it (the registry is built per run), with `Stop` read as
 * `SubagentStop` (sub-agents.md). Which agents' hooks run is the kit's (`agentHooksRun`); a fork
 * is its delegator, not the agent, so it keeps the delegator's own.
 */
export function agentScopedHooks(
  session: Pick<SessionRecord, 'provenance'>,
  agent: HookedAgent | undefined,
  options: { projectTrusted: boolean },
): ScopedCcHooks[] {
  const { provenance } = session
  if (provenance.kind !== 'task-delegation' || provenance.fork) return []
  if (!agent || !agentHooksRun(agent, options.projectTrusted)) return []
  return [
    {
      raw: agent.hooks,
      source: 'agent',
      asSubagent: true,
      ...(provenance.agentType ? { agentType: provenance.agentType } : {}),
    },
  ]
}
