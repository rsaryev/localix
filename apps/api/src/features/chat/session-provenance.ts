import type { AgentSessionKind } from '../../db'
import { DELEGATION_PRIORITIES, type DelegationPriority } from '../agent-core/delegation-lanes'

const isDelegationPriority = (value: unknown): value is DelegationPriority =>
  (DELEGATION_PRIORITIES as readonly unknown[]).includes(value)

/** Durable, session-level provenance. This is the only creator taxonomy persisted on a session. */
export type SessionProvenance =
  | { kind: 'root' }
  | {
      kind: 'task-delegation'
      parentSessionId: string
      toolCallId: string
      /**
       * WHICH PARTICIPANT of the parent spawned it.
       *
       * The parent session id is not enough once a conversation can have several agents in it:
       * a room's members share one session, so every member's prompt listed every member's
       * children as its own — the same misattribution the history projection exists to stop,
       * arriving through the roster instead of the transcript.
       */
      parentParticipant?: string
      /**
       * How urgent the delegated task is (`delegation-lanes.ts`): set on `delegate`, inherited by
       * the child's later runs, overwritten by a message that names another. Absent on a child
       * delegated before priorities existed — read as `normal`.
       */
      priority?: DelegationPriority
      /**
       * Where it sits in the delegation tree (`delegation-hierarchy.ts`): 1 for a conversation's
       * child, 2 for that child's child. Written once, at creation, so no read walks the ancestry
       * — a walk can be wrong (a deleted row) and every run would pay for it.
       */
      depth?: number
      /** Agent ids that delegated down to it, root first — the agents it may never hand work to. */
      chain?: string[]
      /**
       * The folder it works in instead of its tree's (`session-cwd.ts`): the git worktree a
       * workflow agent with `isolation: 'worktree'` was given. Honoured only inside Localix's
       * worktree root and while the folder exists.
       */
      workingDir?: string
      /** A WorktreeCreate hook made {@link workingDir}: honoured wherever the hook put it. */
      worktreeByHook?: true
      /**
       * The plugin subagent type it runs as (`<plugin>:<name>`): every run of the child takes that
       * agent's prompt and tool limits while the plugin is enabled (`run/plugin-subagent.ts`).
       */
      pluginAgent?: string
    }
  | { kind: 'loop'; parentSessionId: string; loopId: string }
  | { kind: 'hook'; parentSessionId: string; phase: 'verifier' }
  | {
      kind: 'skill-fork'
      parentSessionId: string
      parentParticipant?: string
      /**
       * The plugin subagent type a `context: fork` skill's `agent:` names: the fork runs with that
       * agent's prompt and tool limits, as a delegated one does (`run/plugin-subagent.ts`).
       */
      pluginAgent?: string
    }
  | { kind: 'thread'; parentSessionId: string; phase: 'message' }
  | { kind: 'fork'; parentSessionId: string }
  | { kind: 'external-agent'; parentSessionId: string; toolCallId: string }
  /** First-class "we do not know who created this" — a real stored value (the
   * 20260818T010002 normalization target and the fail-closed write default),
   * NOT a read-time fallback. */
  | { kind: 'unknown-origin' }

export type SessionExecutionClass = 'interactive' | 'isolated-worker' | 'passive'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const optionalString = (value: unknown): value is string | undefined =>
  value === undefined || isString(value)
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))
const isDepth = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString)

/**
 * A session's place in the delegation tree: a conversation is depth 0 with nobody above it; a
 * delegated child reads what its creation wrote. A child from before depths existed was
 * created when delegation was one level deep, so it is depth 1.
 */
export function delegationPlace(provenance: SessionProvenance): {
  depth: number
  chain: readonly string[]
} {
  if (provenance.kind !== 'task-delegation') return { depth: 0, chain: [] }
  return { depth: provenance.depth ?? 1, chain: provenance.chain ?? [] }
}

/** 20260818T010002 normalized every stored payload to a known kind, and the only
 * writer serializes this very type — an unparseable value is a code bug writing
 * through the wrong seam, so it must halt the read, not demote the session. */
function reject(raw: string | null | undefined): never {
  throw new Error(
    `Unrecognized session provenance ${JSON.stringify(raw ?? null)}: stored rows were ` +
      'normalized by migration 20260818T010002, so this value was written by a bug.',
  )
}

/** Strict parse of persisted provenance. Throws on anything but a known kind. */
export function parseSessionProvenance(raw: string): SessionProvenance {
  if (!raw) reject(raw)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    reject(raw)
  }
  if (!isRecord(value) || !isString(value.kind)) reject(raw)

  switch (value.kind) {
    case 'root':
      return hasOnlyKeys(value, ['kind']) ? { kind: 'root' } : reject(raw)
    case 'task-delegation':
      return hasOnlyKeys(value, [
        'kind',
        'parentSessionId',
        'toolCallId',
        'parentParticipant',
        'priority',
        'depth',
        'chain',
        'workingDir',
        'worktreeByHook',
        'pluginAgent',
      ]) &&
        isString(value.parentSessionId) &&
        isString(value.toolCallId) &&
        optionalString(value.parentParticipant) &&
        (value.priority === undefined || isDelegationPriority(value.priority)) &&
        (value.depth === undefined || isDepth(value.depth)) &&
        (value.chain === undefined || isStringList(value.chain)) &&
        optionalString(value.workingDir) &&
        (value.worktreeByHook === undefined || value.worktreeByHook === true) &&
        optionalString(value.pluginAgent)
        ? {
            kind: 'task-delegation',
            parentSessionId: value.parentSessionId,
            toolCallId: value.toolCallId,
            ...(value.parentParticipant ? { parentParticipant: value.parentParticipant } : {}),
            ...(isDelegationPriority(value.priority) ? { priority: value.priority } : {}),
            ...(isDepth(value.depth) ? { depth: value.depth } : {}),
            ...(isStringList(value.chain) ? { chain: value.chain } : {}),
            ...(value.workingDir ? { workingDir: value.workingDir } : {}),
            ...(value.worktreeByHook === true ? { worktreeByHook: true as const } : {}),
            ...(value.pluginAgent ? { pluginAgent: value.pluginAgent } : {}),
          }
        : reject(raw)
    case 'loop':
      return hasOnlyKeys(value, ['kind', 'parentSessionId', 'loopId']) &&
        isString(value.parentSessionId) &&
        isString(value.loopId)
        ? { kind: 'loop', parentSessionId: value.parentSessionId, loopId: value.loopId }
        : reject(raw)
    case 'hook':
      return hasOnlyKeys(value, ['kind', 'parentSessionId', 'phase']) &&
        isString(value.parentSessionId) &&
        value.phase === 'verifier'
        ? { kind: 'hook', parentSessionId: value.parentSessionId, phase: 'verifier' }
        : reject(raw)
    case 'skill-fork':
      return hasOnlyKeys(value, ['kind', 'parentSessionId', 'parentParticipant', 'pluginAgent']) &&
        isString(value.parentSessionId) &&
        optionalString(value.parentParticipant) &&
        optionalString(value.pluginAgent)
        ? {
            kind: 'skill-fork',
            parentSessionId: value.parentSessionId,
            ...(value.parentParticipant ? { parentParticipant: value.parentParticipant } : {}),
            ...(value.pluginAgent ? { pluginAgent: value.pluginAgent } : {}),
          }
        : reject(raw)
    case 'thread':
      return hasOnlyKeys(value, ['kind', 'parentSessionId', 'phase']) &&
        isString(value.parentSessionId) &&
        value.phase === 'message'
        ? { kind: 'thread', parentSessionId: value.parentSessionId, phase: 'message' }
        : reject(raw)
    case 'fork':
      return hasOnlyKeys(value, ['kind', 'parentSessionId']) && isString(value.parentSessionId)
        ? { kind: 'fork', parentSessionId: value.parentSessionId }
        : reject(raw)
    case 'external-agent':
      return hasOnlyKeys(value, ['kind', 'parentSessionId', 'toolCallId']) &&
        isString(value.parentSessionId) &&
        isString(value.toolCallId)
        ? {
            kind: 'external-agent',
            parentSessionId: value.parentSessionId,
            toolCallId: value.toolCallId,
          }
        : reject(raw)
    case 'unknown-origin':
      return hasOnlyKeys(value, ['kind']) ? { kind: 'unknown-origin' } : reject(raw)
    default:
      return reject(raw)
  }
}

export function serializeSessionProvenance(provenance: SessionProvenance): string {
  return JSON.stringify(provenance)
}

export function sessionExecutionClass(provenance: SessionProvenance): SessionExecutionClass {
  switch (provenance.kind) {
    case 'root':
    case 'thread':
    case 'fork':
      return 'interactive'
    case 'task-delegation':
    case 'loop':
    case 'hook':
    case 'skill-fork':
    case 'external-agent':
      return 'isolated-worker'
    case 'unknown-origin':
      return 'passive'
  }
}

type SessionIdentity = {
  id: string
  sessionKind: AgentSessionKind
  parentSessionId: string | null
  rootSessionId: string | null
}

/** Validate that persisted interactive provenance agrees with the session lineage. */
export function isTrustedInteractiveSession(
  session: SessionIdentity,
  provenance: SessionProvenance,
): boolean {
  if (session.sessionKind !== 'chat' || sessionExecutionClass(provenance) !== 'interactive') {
    return false
  }
  if (provenance.kind === 'root') {
    return (
      session.parentSessionId === null &&
      (session.rootSessionId === null || session.rootSessionId === session.id)
    )
  }
  if (provenance.kind === 'thread' || provenance.kind === 'fork') {
    return session.parentSessionId === provenance.parentSessionId && session.rootSessionId !== null
  }
  return false
}
