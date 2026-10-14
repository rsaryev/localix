/**
 * Auto-continuation tail of a successful run. The policies are checked in priority order
 * behind one shared idle gate (`canContinue`): a pending configuration reload and a
 * Claude Code Stop/SubagentStop block. Each either
 * seeds an internal nudge turn and re-enters the runner through `reenterRun`, or (the
 * reports whether a continuation was started, so the caller skips the terminal
 * publishRuntimeSession when control was handed to the next segment.
 */
import { isLoopingStop } from './stop-notice'
import type { SessionRecord } from '../../repository'
import { insertInternalTurn } from '../message-persistence'
import { sessionAgent } from '../message-envelope'
import type { RunTurnState } from './turn-state'
import type { RunChain, RunEnv, RunParams } from './types'
import { reenterRun } from './reenter-run'

/**
 * Hard cap on consecutive Claude Code Stop / SubagentStop `decision:"block"`
 * continuations. CC's own loop-protection is the `stop_hook_active` input flag (a
 * hook is expected to check it and not block again); we ALSO cap here so a hook
 * that ignores the flag can never loop the agent forever.
 */
const MAX_HOOK_STOP_CONTINUATIONS = 5

/**
 * Insert an internal nudge turn, then re-enter the runner for a continuation
 * segment. The seeded internal assistant is excluded from the history the
 * continuation replays; scope and chain travel whole through `reenterRun`.
 */
async function startContinuationRun(args: {
  env: RunEnv
  userId: string
  session: SessionRecord
  content: string
  /** Opaque wake provenance (domain WakeSource) for the seeded turn, e.g. 'hook'. */
  origin?: string
  /** The finishing run's params — its scope and chain are carried forward. */
  params: RunParams
  abort: AbortController
  reason: string
  chain?: Partial<Omit<RunChain, 'continuation'>>
}): Promise<boolean> {
  const { env, userId, session, content, params } = args
  if (args.abort.signal.aborted) return false

  const { assistantMessage } = await insertInternalTurn({
    agent: sessionAgent(session, params.scope.speakerAgentId),
    repo: env.repo,
    streamRegistry: env.deps.streamRegistry,
    now: env.now,
    userId,
    sessionId: session.id,
    content,
    origin: args.origin,
  })

  // oxlint-disable-next-line react-doctor/server-sequential-independent-await -- continuation history must include the internal turn inserted immediately above
  const allMessages = await env.repo.listMessages(userId, session.id)
  return reenterRun({
    env,
    params,
    abort: args.abort,
    reason: args.reason,
    turn: {
      session,
      historyMessages: allMessages.filter((m) => m.id !== assistantMessage.id),
      assistantMessageId: assistantMessage.id,
    },
    chain: args.chain,
  })
}

/**
 * Run the auto-continuation chain for a finished run. Returns true when a
 * continuation was started (the caller must then NOT publish a terminal runtime
 * status — the next run owns it). A continuation may only chain off a run that
 * wasn't aborted or stopped by the user.
 */
export async function maybeStartContinuation(args: {
  env: RunEnv
  userId: string
  session: SessionRecord
  state: RunTurnState
  params: RunParams
  abort: AbortController
  /**
   * A Claude Code Stop / SubagentStop hook returned `decision:"block"` — the agent
   * must keep working with this reason fed back to it. undefined = no block.
   */
  hookStopReason?: string
}): Promise<boolean> {
  const { env, userId, session, state, params, abort } = args
  const { stoppedRuntimeSessionIds } = env.state

  // A continuation is a FRESH agent loop, which means fresh no-progress counters.
  // Auto-resuming a run that a guard braked for looping therefore un-brakes it: the
  // model picks the loop straight back up. Refuse — the notice the finalizer wrote
  // stands, and the user can continue by sending a message.
  // Shared automatic-idle gate. User/client work always wins over extension work:
  // never launch a continuation while a queued user/control turn is waiting to drain.
  const canContinue =
    !abort.signal.aborted &&
    !stoppedRuntimeSessionIds.has(session.id) &&
    !isLoopingStop(state.stopReason) &&
    !(await env.hasPendingQueue(session.id))
  if (abort.signal.aborted || stoppedRuntimeSessionIds.has(session.id)) return false

  // A capability proposal is applied while this run still holds its original tool registry.
  // Re-enter automatically so the approved tool is usable without asking the person to send a
  // second message. This comes before ordinary completion gates because it is runtime plumbing,
  // not unfinished intent inferred from prose.
  if (canContinue && state.configurationReloadPending) {
    return startContinuationRun({
      env,
      userId,
      session,
      params,
      abort,
      reason: 'configuration-reload',
      content:
        'The approved configuration change is now loaded. Continue the original request with the refreshed tools.',
      origin: 'configuration',
    })
  }

  // ---- Claude Code Stop / SubagentStop `decision:"block"` re-entry ------
  // A Stop (or delegated-sub-agent SubagentStop) hook asked the agent to KEEP
  // WORKING instead of finalizing (CC: "prevents Claude from stopping, continues
  // the conversation"). Re-enter once with the hook's reason fed back as an
  // internal user-side turn — NOT a real user message (origin:'hook'). Checked
  // LAST so a configuration reload takes precedence; the
  // Stop hook re-fires on that run's finalize anyway. Gated on `canContinue`, so a
  // human Stop is FINAL and never re-enters, and hard-capped to break a hook that
  // ignores `stop_hook_active`.
  if (canContinue && args.hookStopReason) {
    const count = params.chain.hookStopContinuationCount
    if (count < MAX_HOOK_STOP_CONTINUATIONS) {
      return startContinuationRun({
        env,
        userId,
        session,
        params,
        abort,
        reason: 'hook-stop',
        content: args.hookStopReason,
        origin: 'hook',
        chain: { hookStopContinuationCount: count + 1 },
      })
    }
  }

  return false
}
