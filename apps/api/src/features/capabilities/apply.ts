import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { whenCapabilitiesSettle } from './settle'
import { ACTION_PREFIX, type CapabilityKind } from './resolve'
import type { RuleChange } from './rule-changes'
import type { AvailabilityWriter } from './availability'
import type { CapabilityScope, CapabilityRulesApplyRequest } from './contracts'
import type { CapabilitySnapshot } from '../../contracts/capability-snapshot'
import type { CapabilitySnapshotService } from './snapshot'

/**
 * How long a change that re-wires live hosts waits for them before answering anyway. Long
 * enough for a normal reconcile, short enough that a wedged plugin backend costs one slow
 * response rather than a hung request.
 */
const SETTLE_TIMEOUT_MS = 3_000

/** The kind an action names, or null for one this installation has no prefix for. */
export function kindOfAction(action: string): CapabilityKind | null {
  for (const [kind, prefix] of Object.entries(ACTION_PREFIX)) {
    if (action.startsWith(prefix)) return kind as CapabilityKind
  }
  return null
}

/** The name an action carries, past its kind prefix. `mcp:github/create_pr` → `github/create_pr`. */
export const nameOfAction = (kind: CapabilityKind, action: string): string =>
  action.slice(ACTION_PREFIX[kind].length)

/**
 * The names one kind's changes are about, optionally only those asking for a given effect.
 *
 * Reactions differ in which half they care about: a dependency cascade follows an `allow`, a
 * refusal guards a `deny`, a cache invalidation wants both. Only changes about the capability
 * ITSELF count — a rule narrowing one tool's arguments is not a statement about the tool
 * being there, and a reaction that treated it as one would re-wire a host over an edit to a
 * command pattern.
 */
export function namesOf(
  changes: readonly RuleChange[],
  kind: CapabilityKind,
  wanted?: (effect: RuleChange['effect']) => boolean,
): string[] {
  const names = changes.flatMap((change) =>
    change.resource === '*' && (!wanted || wanted(change.effect))
      ? [nameOfAction(kind, change.action)]
      : [],
  )
  return [...new Set(names)]
}

/**
 * What a kind needs done BESIDES writing the rule.
 *
 * Not a switch and not a second store — the rule is the whole state. A reaction is the
 * domain consequence of that rule changing: a plugin's dependency cascade, an inspection
 * cache to drop, a live host to re-wire. Each stays with the feature that owns it.
 */
export interface CapabilityReaction {
  /**
   * Refuse the request before anything is written. For the rules a kind cannot accept at
   * all — the agent the app itself runs on cannot be denied, whatever the scope.
   */
  validate?(userId: string, scope: CapabilityScope, changes: readonly RuleChange[]): Promise<void>
  /**
   * Extra rule changes this one implies, computed BEFORE the write so that everything lands
   * in one transaction. Enabling a plugin pulls in its installed dependencies this way; a
   * cascade that wrote separately could leave a plugin allowed without them.
   */
  expand?(
    userId: string,
    scope: CapabilityScope,
    changes: readonly RuleChange[],
  ): Promise<RuleChange[]>
  /** Run once, after the write lands. Cache invalidation, host re-wire, change notifications. */
  after?(userId: string, scope: CapabilityScope, changes: readonly RuleChange[]): Promise<void>
  /** Whether a change of this kind re-wires live hosts and is worth waiting for. */
  settles?: boolean
}

export type CapabilityReactions = Partial<Record<CapabilityKind, CapabilityReaction>>

export interface CapabilityApplyService {
  apply(userId: string, input: CapabilityRulesApplyRequest): Promise<CapabilitySnapshot>
}

/**
 * THE write path for capability policy — one primitive, every kind.
 *
 * There used to be a `toggle` endpoint here taking `{kind, name, enabled}`, fanning out to a
 * `set<Kind>Enabled` port per kind, each doing its own read-modify-write of the same stored
 * list. Three costs, all paid: the store carried a second vocabulary that had to be
 * translated at seven seams; five transactions per request could interleave with another
 * client's; and "on" meant something slightly different per kind, so the screen and the run
 * could disagree about what a switch had done.
 *
 * A capability rule is the whole state, so the wire says what the rule should be. The four
 * settings tabs still show a switch — that is sugar, and it lives in the client where the
 * only cost of being wrong is a re-render.
 */
export function createCapabilityApplyService(deps: {
  availability: AvailabilityWriter
  snapshots: CapabilitySnapshotService
  reactions: CapabilityReactions
  /** Overridable in tests; production waits on the backend host's settle hook. */
  awaitSettle?: (timeoutMs: number) => Promise<void>
}): CapabilityApplyService {
  const awaitSettle = deps.awaitSettle ?? whenCapabilitiesSettle

  return {
    async apply(userId, input) {
      // `projectId` says what to LIST (a project's installed plugins, MCP servers, skills);
      // `agentId` says whose rules to WRITE. They answer different questions, which is why
      // one request carries both — and why a missing agent is the one that always exists
      // rather than a scope of its own.
      const projectId = input.projectId ?? ''
      const agentId = input.agentId || DEFAULT_AGENT_ID
      const scope: CapabilityScope = { projectId, agentId }

      const byKind = new Map<CapabilityKind, RuleChange[]>()
      for (const change of input.changes) {
        const kind = kindOfAction(change.action)
        // An action with no known prefix is still a rule and still stored. The kinds only
        // decide which reactions run; a request must not be refused because a rule names
        // something this installation has no reaction for.
        if (!kind) continue
        const bucket = byKind.get(kind)
        if (bucket) bucket.push(change)
        else byKind.set(kind, [change])
      }

      // Refusals first, so a request a kind cannot accept writes nothing at all.
      for (const [kind, own] of byKind) {
        await deps.reactions[kind]?.validate?.(userId, scope, own)
      }

      let changes: RuleChange[] = [...input.changes]
      for (const [kind, own] of byKind) {
        const reaction = deps.reactions[kind]
        if (reaction?.expand) {
          changes = [...changes, ...(await reaction.expand(userId, scope, own))]
        }
      }

      // ONE read-modify-write for every kind at once. Per-kind writes meant a request that
      // spans kinds — which the Capabilities screen sends routinely — was several
      // transactions with another client's request free to land between them.
      await deps.availability.apply(userId, agentId, changes)

      for (const [kind, own] of byKind) {
        await deps.reactions[kind]?.after?.(userId, scope, own)
      }

      // Only some kinds re-wire live hosts. Waiting for the others would delay every answer
      // for a settle that is never coming: MCP servers connect per run, and so do agents.
      if ([...byKind.keys()].some((kind) => deps.reactions[kind]?.settles)) {
        await awaitSettle(SETTLE_TIMEOUT_MS)
      }

      // The answer is the SAME document the snapshot read returns, computed after the changes
      // land. That is what removes the follow-up request a mutation used to need — and with
      // it the window where two clients could interleave.
      return deps.snapshots.getSnapshot({ userId, projectId, agentId })
    },
  }
}
