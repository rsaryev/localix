/**
 * THE RUN CONTRACT: what a dispatcher must state to start an agent run, and what one
 * physical segment of a logical run hands to the next.
 *
 * It lives in the infrastructure layer rather than in `run/` because both sides of the
 * boundary name it: the session layer BUILDS these values (`run-params.ts`), the wake queue
 * CARRIES them, and `run/` CONSUMES them. Putting the shape here is what lets the layering
 * rule stay absolute — no infrastructure module needs to reach into the use-case directory
 * to describe the call it is making (see `runtime-layers.test.ts`).
 *
 * The fields are grouped by LIFETIME, and that grouping is the point: `RunScope` is who the
 * run is and lasts the whole logical run; `RunChain` is what it has already spent and is
 * carried-then-patched by every re-entry. See `run-params.ts` for the constructors that are
 * the only legal way to build either.
 */
import type { RunProfile } from '../../agent-core/run-shape'
import type { ToolRequirement } from '../../agent-core/required-tools'
import type { PersistedMessage } from '../contracts'
import type { SessionRecord } from '../repository'
import type { RunExecutionContext } from './execution-context'
import type { RunCompletion } from './run-outcome'

/** The one turn a run answers: whose session, which history, which assistant row it fills. */
export interface RunTurn {
  userId: string
  session: SessionRecord
  historyMessages: PersistedMessage[]
  /** Latest boundary removed from history at admission; carried through retries and continuations. */
  contextBoundaryId?: string
  assistantMessageId: string
}

/** A run-scoped CC hooks block from a skill's or a sub-agent's frontmatter. */
export interface ScopedCcHooks {
  raw: unknown
  source: 'skill' | 'agent'
  /** `Stop` → `SubagentStop` (a `context: fork` skill / a delegated agent). */
  asSubagent?: boolean
  /** Agent type surfaced on a self-fired SubagentStop (delegated agent / fork skill). */
  agentType?: string
  /**
   * The plugin that ships the skill or agent: its hooks get `${CLAUDE_PLUGIN_ROOT}` and
   * `${CLAUDE_PLUGIN_DATA}` like the plugin's own `hooks.json`.
   */
  plugin?: { name: string; root: string; dataDir: string }
}

/**
 * WHO the run is: the identity a dispatcher resolved for it. Set once at dispatch and
 * carried WHOLESALE across every re-entry of the logical run (continuation, retry,
 * compact-and-rerun) — and, for a job/subagent session, remembered for the wakes that
 * land on it later (see `run-params.ts`). Chat sessions never remember it: a skill's
 * `allowed-tools` is a one-run grant, and remembering it would widen authority.
 */
export interface RunIdentity {
  /**
   * WHICH PARTICIPANT is speaking.
   *
   * A multi-participant turn is the ordinary run dispatched once per member, so the only thing
   * that distinguishes those runs is this stable execution address. Runtime consumers resolve
   * the participant by this ID; participant order remains conversation state.
   *
   * A remembered wake identity may omit it before the next dispatch resolves an address.
   */
  speakerAgentId?: string
  /** Host candidate tool roster; native identity instructions are resolved separately. */
  hostTools?: readonly string[]
  /** Tools the host needs to finish the task; requirements never grant tool access. */
  requiredTools?: readonly ToolRequirement[]
  /**
   * A custom RunProfile instead of the one derived from sessionKind alone — a delegated
   * sub-agent's role, a forked skill's. The runner stays domain-agnostic
   * and just applies it.
   */
  profileOverride?: RunProfile
  /** Tool names disabled for this run (skill `disallowed-tools`); merged into the session's. */
  extraDisabledTools?: string[]
  /** Tool names auto-approved for this run (skill `allowed-tools`); front-injected allow rules. */
  extraAllowedTools?: string[]
  /** CC `maxTurns` of a delegated sub-agent definition; undefined = the host default. */
  maxTurns?: number
  /**
   * A model for THIS run only (a CC command's `model:` frontmatter). It rides the scope because
   * the dispatcher re-reads the session when the ticket runs, so an override applied to the
   * enqueuing caller's snapshot never reached the run. Applied to the run's session copy, never
   * persisted: the user's model choice is untouched.
   */
  modelOverride?: string
  /** Run-scoped CC hooks merged into the per-run cc-hooks registry. */
  ccScopedHooks?: ScopedCcHooks[]
}

/** Identity plus the trusted authority the run acts under. */
export interface RunScope extends RunIdentity {
  /** Every concrete runtime dispatch has one unambiguous participant address. */
  speakerAgentId: string
  /** Scheduling generation, shared by explicit handoffs; never a second participant queue. */
  conversationId?: string
  /** Why this participant has the floor. Volatile guidance, carried through retries. */
  turnTrigger?: {
    kind: 'colleague-request'
    messageIds: readonly string[]
    /**
     * The request is a REPORT on work this participant handed out, not an assignment. A reply to
     * a report that addresses nobody ends with the person instead of bouncing back to the
     * reporter, which would otherwise ping-pong the floor until the handoff limit.
     */
    report?: boolean
  }
  /**
   * Handoffs since the person last spoke: absent on a turn that answers them, one more on each
   * colleague handoff. Bounded by `MAX_HANDOFF_CHAIN`; durable because it rides the ticket.
   */
  handoffDepth?: number
  /** Trusted invocation provenance + authority, separate from client-supplied UI capabilities. */
  executionContext: RunExecutionContext
}

/**
 * The bounded memory of one LOGICAL run across its physical segments. Every value here
 * is a loop-brake or a one-shot latch; dropping any of them on a re-entry refills a
 * budget the previous segment already spent. `reenterParams` is the only writer.
 */
export interface RunChain {
  /** Terminal observer shared by every segment; settled once by the last one. */
  completion?: RunCompletion
  /**
   * This segment is a re-entrant continuation (configuration reload, hook stop, retry)
   * reusing/seeding a fresh assistant message — not a user turn. The pre-token activity
   * phases are suppressed so the status reel doesn't replay them.
   */
  continuation: boolean
  /**
   * A recovery checkpoint already fired for this turn (one-shot; breaks the
   * checkpoint→overflow loop when even the checkpointed view does not fit).
   */
  checkpointRecovered: boolean
  /** Transient mid-stream retries spent on this turn (cap: MAX_TRANSIENT_RETRIES). */
  transientRetryCount: number
  /**
   * Consecutive CC Stop/SubagentStop `decision:"block"` continuations before this one.
   * > 0 makes this run itself a hook-forced continuation (`stop_hook_active`).
   */
  hookStopContinuationCount: number
}

/** Parameters of one agent run — the public `runner.run()` contract. */
export interface RunParams extends RunTurn {
  scope: RunScope
  chain: RunChain
}
