/**
 * Claude Code's end-of-turn hooks: `Stop` for the main agent, `SubagentStop` for a delegated child.
 *
 * Both fire when the turn's response is complete. A `decision:"block"` asks the agent to KEEP
 * WORKING with the reason fed back to it (CC: "prevents Claude from stopping, continues the
 * conversation"; for SubagentStop, "keeps the subagent running and delivers `reason` to the
 * subagent as its next instruction"). The caller honours it through the continuation seam
 * (`run-continuations.ts`), which is gated and hard-capped. `stop_hook_active` tells a well-behaved
 * hook it is already inside a hook-forced continuation so it can decline to block again.
 *
 * A delegated child is a subagent: its end fires SubagentStop — every source's, settings and
 * plugins included — and never Stop, which CC runs only "when the main Claude Code agent has
 * finished responding". It fires here, in the child's own run, because only here can a block
 * still keep the child working; the delegating parent learns of the end too late to.
 */
import type { CcHooksRuntime } from '../../../cc-hooks'
import { GENERAL_PURPOSE_AGENT } from '../../../ext/cc-agent-selection'
import type { SessionRecord } from '../../repository'
import type { RunParams } from './types'

const STOP_REASON = 'A Stop hook asked you to keep working. Continue the task.'
const SUBAGENT_STOP_REASON = 'A SubagentStop hook asked you to keep working. Continue the task.'

/** The reason to keep working when a Stop / SubagentStop hook blocked, else undefined. */
export async function runStopHooks(args: {
  ccHooks: CcHooksRuntime
  session: SessionRecord
  scope: Pick<RunParams['scope'], 'ccScopedHooks' | 'speakerAgentId'>
  stopHookActive: boolean
  /** The reply that ends the turn (`last_assistant_message`). */
  content: string | null
}): Promise<string | undefined> {
  const { ccHooks, session, scope, stopHookActive, content } = args
  // A PreToolUse `continue:false` or a PostToolBatch block ended the run: Claude Code "stops
  // processing entirely", which "takes precedence over any event-specific decision fields", so
  // no end-of-turn hook may block the stop and send the agent back to work.
  if (ccHooks.stoppedBy()) return undefined
  const provenance = session.provenance
  if (provenance.kind === 'task-delegation') {
    // The type the parent's SubagentStart named: the plugin agent type, else the seated agent.
    const agentType = provenance.pluginAgent ?? scope.speakerAgentId
    const stop = await ccHooks.runSubagentStop(agentType, session.id, content, { stopHookActive })
    return stop.blocked ? stop.reason || SUBAGENT_STOP_REASON : undefined
  }
  const stop = await ccHooks.runStop({ stopHookActive, lastAssistantMessage: content ?? '' })
  let reason = stop.blocked ? stop.reason || STOP_REASON : undefined
  // A `context: fork` skill whose frontmatter `Stop` hooks were converted to `SubagentStop`
  // fires them on its OWN completion, scoped to skill/agent sources. A block rides the same
  // continuation seam as Stop.
  const subScoped = (scope.ccScopedHooks ?? []).find((s) => s.asSubagent)
  if (subScoped) {
    const selfStop = await ccHooks.runSubagentStop(
      subScoped.agentType ?? GENERAL_PURPOSE_AGENT,
      session.id,
      content,
      { sourcesOnly: ['skill', 'agent'], stopHookActive },
    )
    if (selfStop.blocked && !reason) reason = selfStop.reason || SUBAGENT_STOP_REASON
  }
  return reason
}
