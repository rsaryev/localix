/**
 * Stop and SubagentStop (hooks.md, "Stop input"): the end-of-turn hooks, which also read the
 * session's running work and scheduled loops (`background_tasks`, `session_crons`), "scoped to the
 * parent session, not the subagent".
 */
import type { CcHookInput } from './contracts'
import { matchesField } from './matcher'
import type { CcHooksRuntime, CreateCcHooksRuntimeOptions } from './runtime-contracts'
import { stopVerdictFrom } from './runtime-results'
import type { HookDispatchDeps } from './runtime-tool-hooks'

export function createStopHookRunners(
  { runAll, baseInput }: HookDispatchDeps,
  backgroundOf: () => { background_tasks: unknown[]; session_crons: unknown[] },
  transcript: CreateCcHooksRuntimeOptions['transcript'],
): Pick<CcHooksRuntime, 'runStop' | 'runSubagentStop'> {
  return {
    async runStop(stopOpts) {
      const input: CcHookInput = {
        ...baseInput('Stop'),
        stop_hook_active: Boolean(stopOpts?.stopHookActive),
        last_assistant_message: stopOpts?.lastAssistantMessage ?? '',
        ...backgroundOf(),
      }
      return stopVerdictFrom(await runAll('Stop', () => true, input, false))
    },

    async runSubagentStop(agentType, agentId, lastMessage, subOpts) {
      const sourcesOnly = subOpts?.sourcesOnly
      const input: CcHookInput = {
        ...baseInput('SubagentStop'),
        agent_id: agentId,
        agent_type: agentType,
        ...(lastMessage ? { last_assistant_message: lastMessage } : {}),
        stop_hook_active: Boolean(subOpts?.stopHookActive),
        agent_transcript_path: transcript?.agentPath(agentId) ?? '',
        // "scoped to the parent session, not the subagent".
        ...backgroundOf(),
      }
      return stopVerdictFrom(
        await runAll('SubagentStop', (m) => matchesField(m, agentType), input, false, {
          filter: (h) => !sourcesOnly || sourcesOnly.includes(h.source),
        }),
      )
    },
  }
}
