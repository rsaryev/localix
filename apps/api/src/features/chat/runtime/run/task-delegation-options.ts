import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { CcHooksRuntime } from '../../../cc-hooks'
import type { SessionRecord } from '../../repository'
import type { LineageDecision } from '../../policy/axes/lineage'
import { getAgentService } from '../agent-service-binding'
import type { RunnerDeps } from '../agent-runner-types'
import type { EarlyDelegationOutcome } from '../../../agent-core/tools/task-delegation-contracts'
import { agentParticipant } from '../../../../db/participant'
import { delegationReportWake } from '../delegation-report'
import { releaseLane, requestLane } from '../../../agent-core/delegation-lanes'
import {
  deliverHeldReport,
  expectReport,
  settleReport,
  takeExpectedReport,
  takeTurnLimit,
} from '../../../agent-core/delegation-awaits'
import { wrapSystemReminder } from '../system-reminder'
import { delegationPlace } from '../../session-provenance'
import { endSubagentWork, type SubagentWorkDeps } from './subagent-work'
import { releaseChildSurfaces, type ChildSurfaceDeps } from './child-surfaces'
import { copyConversationForDelegate } from './delegate-context'

/**
 * How long a delegation call watches its child before returning "running".
 *
 * Without a settle window, a role that fails to resolve or a child that exits before its
 * first model token looks exactly like healthy detached work until a later wake arrives.
 * The parent needs that startup outcome in the same turn so it can react without extra
 * status checks. The window is short enough to keep the call non-blocking and long enough
 * to catch failures that happen before the first model token.
 */
const DELEGATION_SETTLE_MS = 1_200

/** Everything the delegate host needs from the run being assembled. */
export interface TaskDelegationOptionsInput {
  userId: string
  session: SessionRecord
  /** Where the session sits in its tree: only the original conversation creates children. */
  lineage: LineageDecision
  agentId?: string
  /** The run's effective cwd — a memory-backed sub-agent resolves its memory dir from it. */
  defaultCwd: string
  agentProfile: RunProfile
  repo: RunnerDeps['repo']
  deps: Pick<RunnerDeps, 'providerConnectionsService' | 'streamRegistry'> & ChildSurfaceDeps
  /** Per-run CC-hook runtime → the child run fires SubagentStart/SubagentStop. */
  ccHooks?: CcHooksRuntime
  /** Where a detached child is recorded as the session's background work (`sub-N`). */
  subagentWork: SubagentWorkDeps
  /** The calling turn's live assistant row — left out of a child's copy of the conversation. */
  currentMessageId?: () => string
}

/**
 * Wire the child-session host for a run that may create children with `delegate`. Runtime
 * capability policy is the independent authority gate.
 *
 * Returns `undefined` whenever a precondition is missing: the session cannot create children,
 * or no agent service is bound yet.
 */
export function buildTaskDelegationOptions(
  input: TaskDelegationOptionsInput,
): TaskDelegationOptions | undefined {
  const { userId, session, agentProfile, ccHooks } = input

  // Persisted nested sessions remain readable, but only the root can create new child work.
  if (!input.lineage.mayDelegate || !isToolDirect(agentProfile, TOOL.delegate)) return undefined
  const place = delegationPlace(session.provenance)
  // The `delegation` model route is a ROUTE, never a switch for the tool. With the route off
  // a child simply runs on the session model (the picker's own "Use session model" promise);
  // gating the port on it once removed delegation from a chat whose user had merely not
  // picked a delegation model, and the agent told them the tool did not exist.
  const svc = getAgentService()
  if (!svc?.resolveDelegateAgent || !svc.wakeSession) return undefined
  const resolveDelegateAgent = svc.resolveDelegateAgent

  return {
    userId,
    parentSessionId: session.id,
    projectId: session.projectId,
    resolveAgent: (reference, scope) => resolveDelegateAgent(reference, scope),
    // The child inherits the parent's permission mode. Without this it was created
    // with `createSession`'s `auto` default, so a delegate spawned from an `ask`
    // session ran bash and wrote files with no confirmation — delegation is not a
    // privilege escalation the user asked for. See `subagent-mode.ts`.
    // Returns `{ id, taskName }`: the addressable name comes back off the created row (the store
    // assigns it — see `agent-core/agent-task-name.ts`), so the delegation result can identify
    // the child without exposing only an opaque ref.
    createSession: (uid, sessionInput) =>
      svc.createSession(uid, {
        ...sessionInput,
        provenance: {
          ...sessionInput.provenance,
          ...(input.agentId ? { parentParticipant: agentParticipant(input.agentId) } : {}),
        },
      }),
    // Where this session sits (`delegation-hierarchy.ts`), as its creation wrote it, and the
    // agent delegating now.
    position: () => ({ ...place, self: input.agentId ?? null }),
    copyConversation: async (childSessionId) => {
      await copyConversationForDelegate(input.repo, {
        userId,
        sourceSessionId: session.id,
        childSessionId,
        delegatingAgentId: input.agentId,
        exclude: input.currentMessageId ? [input.currentMessageId()] : [],
      })
    },
    // Keyed by ROOT: the budget counts the children the whole conversation created since the
    // person last wrote there, whichever participant delegated them.
    delegationsSinceHuman: svc.countDelegationsSinceHuman
      ? () => svc.countDelegationsSinceHuman!(userId, session.rootSessionId ?? session.id)
      : undefined,
    // CC SubagentStart, awaited: its `additionalContext` is put ahead of the child's first
    // prompt. SubagentStop fires in the child's own finalize (`finalize-stop-hooks.ts`), where a
    // block can still keep it working.
    onSubagentStart: ccHooks?.active
      ? async (agentType, agentId) => {
          const { additionalContext } = await ccHooks.runSubagentStart(agentType, agentId)
          return additionalContext ? wrapSystemReminder([additionalContext]) : undefined
        }
      : undefined,
    // NON-BLOCKING delegation: every child is detached, including a child of a child.
    // Return as soon as it is launched. The REPORT is not sent from here: every run of a
    // delegated child reports at its own logical end (`child-run-report.ts`), this first one
    // included, so a child that is messaged and runs again reports again. What stays here is
    // what belongs to the LAUNCH — the settle window, the work record, the lane, SubagentStop.
    startSubagentTask: async (uid, sid, task, taskOpts) => {
      const wake = svc.wakeSession!
      // Resolved by the detached body below when the child dies inside the settle
      // window, so an immediate failure reaches the parent IN THIS TURN instead of
      // only as a wake minutes later. See DELEGATION_SETTLE_MS.
      let reportEarlyExit: ((outcome: EarlyDelegationOutcome) => void) | undefined
      const earlyExit = new Promise<EarlyDelegationOutcome>((resolve) => {
        reportEarlyExit = resolve
      })
      // The run itself — started now if a lane is free, or later by the lane that frees
      // (`delegation-lanes.ts`). Its work record (`sub-N`) is opened by the run's own start
      // (`subagent-work.ts`), the same for this run as for every later one.
      const launch = () =>
        void (async () => {
          // The lane is held for the run's WHOLE life and released here, in a finally that
          // wraps the run. Releasing earlier is what would make the concurrency cap decorative:
          // a failed or stopped child would keep its lane until the process restarted.
          try {
            let launched = true
            try {
              await svc.runJobTask(uid, sid, task, {
                invocation: { kind: 'task-delegation', parentSessionId: session.id },
                wait: true,
                ...(taskOpts.maxTurns ? { maxTurns: taskOpts.maxTurns } : {}),
              })
            } catch (err) {
              launched = false
              console.warn('[delegate] background child run failed:', err)
            }
            // The child's report is its final reply.
            const text =
              (await svc.finalAssistantText?.(uid, sid).catch(() => null))?.trim() || null
            const status = (await svc.childRuntimeStatus?.(sid).catch(() => null)) ?? null
            endSubagentWork(input.subagentWork, sid, status)
            // A child that ran fired SubagentStop in its own finalize; one whose launch threw
            // never ran, so its SubagentStart is closed here (observer-only: nothing to continue).
            if (!launched && ccHooks?.active)
              void ccHooks.runSubagentStop(taskOpts.agentType, sid, text)
            // If the child is already over while the delegating turn is still open, say so
            // through the tool RESULT rather than only through a later wake. A resolve
            // after the settle window has passed is a no-op. A run cut off at its turn limit
            // is partial output, not a failure (CC `maxTurns`).
            reportEarlyExit?.({
              status,
              hasReport: Boolean(text?.trim()),
              ...(takeTurnLimit(sid) ? { partial: true } : {}),
            })
            // A launch that threw never became a run, so no run end will report it — and the
            // parent would wait for a report that never comes. Only that case reports from here:
            // to the delegating call when it waits (`wait: true`), as a wake otherwise.
            if (!launched && takeExpectedReport(sid)) {
              try {
                if (!deliverHeldReport(sid, { status: 'failed', text })) {
                  const handle = session.agents.find((m) => m.agentId === input.agentId)?.handle
                  await wake(
                    delegationReportWake({
                      userId: uid,
                      parent: session,
                      delegatingAgentId: input.agentId,
                      handle,
                      label: taskOpts.label,
                      childSessionId: sid,
                      runId: 'launch',
                      status: status ?? 'failed',
                      text,
                    }),
                  ).catch((err) => console.warn('[delegate] parent wake failed:', err))
                }
              } finally {
                settleReport(sid)
              }
            }
          } finally {
            // Whatever happened, stop holding the lane and stop anyone waiting on the
            // settle window — a child that ended without reaching the report path above
            // must not leave the delegating turn blocked for the full window.
            reportEarlyExit?.({ status: null, hasReport: false })
            // A body that threw before reading the child's status still ends its record — as
            // failed, the same word the report uses for an end nobody could read.
            endSubagentWork(input.subagentWork, sid, null)
            releaseLane(sid)
            // Messages the delegator sent while the launch was starting wait for a lane; a launch
            // that never became a run has no run end to start them from, so it does.
            void svc.flushChildMessages?.(uid, sid)
            releaseChildSurfaces(input.deps, uid, sid)
          }
        })().catch(() => {})

      // The delegator now waits for this task's outcome, however long the child queues for it.
      expectReport(sid, {
        sessionId: session.id,
        ...(input.agentId ? { participant: agentParticipant(input.agentId) } : {}),
      })
      // Over the cap the child WAITS, and says so in this turn's result; it starts on its own.
      const lane = requestLane(session.id, sid, launch, taskOpts.priority, taskOpts.lane)
      if (lane.state === 'queued') return { queued: lane.position }

      // Watch the child through a short settle window so a role that fails to resolve,
      // a provider that refuses, or a child that dies on its first turn is reported in the
      // SAME turn that spawned it. Without the window, the parent gets silence and must wait
      // for a wake to learn that nothing was ever going to arrive. A child still active when
      // the window closes reads as `running`, so the call stays non-blocking.
      return Promise.race([
        earlyExit,
        new Promise<EarlyDelegationOutcome | null>((resolve) =>
          setTimeout(() => resolve(null), DELEGATION_SETTLE_MS),
        ),
      ]).then((early) => early ?? undefined)
    },
  }
}
