/**
 * A detached sub-agent as the session's background work.
 *
 * A delegated child runs in the background of the session that launched it, exactly as a
 * `bash background:true` job does — but it had no work record, so the composer's work strip and
 * `jobs` could not see it, nothing could stop it from there, and a restart left no trace that it
 * had been running at all. This gives it the same three things a job has:
 *
 *   a record (`sub-N`, with the child's session id) → a `kill` action behind the owner gate →
 *   an end that lands the child's terminal status on the record.
 *
 * A child the process dies under is turned `lost` by the registry's boot hydrate, like any work.
 * The record is keyed by the CHILD, not by the delegating tool call, so it is unique however many
 * children one step launches.
 */
import { errorMessage } from '../../../../lib/errors'
import { workStatusOfChild, type WorkOwner } from '../../../work/contracts'
import type { WorkRegistry } from '../../../work/registry'
import type { SessionRecord } from '../../repository'
import type { ActionRegistryEntry } from '../agent-runner-state'
import { getAgentService } from '../agent-service-binding'
import { lineagePolicy } from '../../policy/session-policy'

export interface SubagentWorkDeps {
  work: WorkRegistry
  actionRegistry: Map<string, ActionRegistryEntry>
}

export interface TrackSubagent {
  owner: WorkOwner
  childSessionId: string
  label: string
  /** Stop the child's run; its continuation then ends the record with `stopped`. */
  stop: () => unknown
}

export const subagentWorkKey = (childSessionId: string): string => `subagent:${childSessionId}`

export function trackSubagent(deps: SubagentWorkDeps, input: TrackSubagent) {
  const toolCallId = subagentWorkKey(input.childSessionId)
  deps.work.start({
    owner: input.owner,
    kind: 'subagent',
    label: input.label,
    toolCallId,
    messageId: null,
    childSessionId: input.childSessionId,
  })
  deps.actionRegistry.set(toolCallId, {
    userId: input.owner.userId,
    sessionId: input.owner.sessionId,
    actions: {
      kill: {
        label: 'Stop',
        icon: 'square',
        tone: 'danger',
        // Fire-and-forget like every action: a stop that fails is logged, and the record stays
        // running because the child is.
        execute: () =>
          void Promise.resolve()
            .then(input.stop)
            .catch((error: unknown) =>
              console.warn(
                `[delegate] stopping sub-agent ${input.childSessionId} failed: ${errorMessage(error)}`,
              ),
            ),
      },
    },
  })
  return {
    /** The child settled: record how. Idempotent — only the first end lands. */
    end: (runtimeStatus: string | null): void =>
      endSubagentWork(deps, input.childSessionId, runtimeStatus),
  }
}

/**
 * EVERY RUN of a delegated child is background work of the session that delegated it, with a
 * Stop — not only the run the delegation launched.
 *
 * The record used to be opened by the delegation's continuation, which sees one run. A child that
 * a message woke again ran with no row in its parent's work strip and no Stop: the person could not
 * see it, let alone halt it, short of opening its chat. So the record opens at the start of each
 * run (`stages/admit.ts`) and closes at its end (`child-run-report.ts`). Idempotent: a run that
 * already has a live record — a continuation segment of the same run — opens nothing.
 */
export function trackChildRun(deps: SubagentWorkDeps, userId: string, session: SessionRecord) {
  const { provenance } = session
  if (!lineagePolicy(session).reportsToDelegator || provenance.kind !== 'task-delegation') return
  if (session.closedAt || deps.work.get(subagentWorkKey(session.id))) return
  trackSubagent(deps, {
    owner: { userId, sessionId: provenance.parentSessionId },
    childSessionId: session.id,
    // The priority beside the name only when it says something: `normal` is the default.
    label: [
      session.agent?.name ?? session.title,
      provenance.priority && provenance.priority !== 'normal' ? provenance.priority : null,
    ]
      .filter(Boolean)
      .join(' · '),
    stop: () => getAgentService()?.stopSession?.(session.id, userId),
  })
}

/**
 * End a child's work record from wherever its run is seen to settle — the delegation's own
 * continuation, or the per-run report seam, which must end it BEFORE it wakes the parent so the
 * parent's woken turn does not still list the child as running. Idempotent: the first end lands,
 * and a child with no live record (a follow-up run) changes nothing.
 */
export function endSubagentWork(
  deps: SubagentWorkDeps,
  childSessionId: string,
  runtimeStatus: string | null,
): void {
  const toolCallId = subagentWorkKey(childSessionId)
  deps.actionRegistry.delete(toolCallId)
  if (deps.work.get(toolCallId)) {
    deps.work.end(toolCallId, { status: workStatusOfChild(runtimeStatus) })
  }
}
