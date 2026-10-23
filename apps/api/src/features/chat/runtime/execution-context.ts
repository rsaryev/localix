import type { ToolSurface } from '@localixai/agent/agents'
import type { WakeSource } from '../contracts'
import type { SessionRecord } from '../repository'
import { isTrustedInteractiveSession, type SessionProvenance } from '../session-provenance'
import {
  ORCHESTRATION_DELEGATE_TASK,
  type ExecutionCapability,
} from '../../agent-core/execution-capabilities'

/** Typed provenance of the invocation that owns one agent run. */
export type RunInvocation =
  | { kind: 'root'; source?: WakeSource }
  | { kind: 'channel'; source?: WakeSource }
  | { kind: 'task-delegation'; parentSessionId: string; toolCallId?: string }
  | { kind: 'loop-subsession'; parentSessionId: string; loopId: string }
  | { kind: 'hook'; parentSessionId: string; phase?: 'verifier' }
  | { kind: 'skill-fork'; parentSessionId: string }
  | { kind: 'isolated-continuation'; sessionId: string; source?: WakeSource }

export interface RunExecutionContext {
  invocation: RunInvocation
  /** Trusted host-granted authority. Never populated from a client request. */
  authority: { capabilities: readonly ExecutionCapability[] }
  /** Untrusted client/runtime UI surface, kept separate from host authority. */
  clientSurface?: ToolSurface
}

const PROTECTED_CAPABILITIES = new Set<string>([ORCHESTRATION_DELEGATE_TASK])

/**
 * Host authority is derived from invocation provenance in one place. Root conversations may
 * delegate board tasks. Isolated runs stay non-delegating:
 * they have one job and no child-result coordination role.
 */
function capabilitiesForInvocation(invocation: RunInvocation): readonly ExecutionCapability[] {
  switch (invocation.kind) {
    case 'root':
      return [ORCHESTRATION_DELEGATE_TASK]
    case 'task-delegation':
    case 'loop-subsession':
    case 'skill-fork':
    case 'hook':
    case 'channel':
    case 'isolated-continuation':
      return []
  }
}

/** Root chat runs may orchestrate; client claims cannot add protected authority. */
export function rootExecutionContext(
  clientSurface?: ToolSurface,
  source?: WakeSource,
): RunExecutionContext {
  return {
    invocation: { kind: 'root', ...(source ? { source } : {}) },
    authority: {
      capabilities: capabilitiesForInvocation({ kind: 'root', ...(source ? { source } : {}) }),
    },
    ...(clientSurface ? { clientSurface } : {}),
  }
}

/** Child authority comes only from trusted invocation provenance, never the client surface. */
export function childExecutionContext(
  invocation: Exclude<RunInvocation, { kind: 'root' }>,
  clientSurface?: ToolSurface,
): RunExecutionContext {
  return {
    invocation,
    authority: { capabilities: capabilitiesForInvocation(invocation) },
    ...(clientSurface ? { clientSurface } : {}),
  }
}

/**
 * Fail-closed context reconstruction for queued work that did not carry its
 * originating run context. Interactive chat sessions retain root authority;
 * child/job sessions recover authority from durable provenance across async
 * wake boundaries; unknown and non-delegating worker classes stay closed.
 */
export function sessionExecutionContext(
  session: Pick<
    SessionRecord,
    'id' | 'sessionKind' | 'parentSessionId' | 'rootSessionId' | 'provenance'
  >,
  clientSurface?: ToolSurface,
  source?: WakeSource,
): RunExecutionContext {
  if (isTrustedInteractiveSession(session, session.provenance)) {
    return rootExecutionContext(clientSurface, source)
  }
  return childExecutionContext(
    invocationFromProvenance(session.id, session.provenance, source),
    clientSurface,
  )
}

function invocationFromProvenance(
  sessionId: string,
  provenance: SessionProvenance,
  source?: WakeSource,
): Exclude<RunInvocation, { kind: 'root' }> {
  switch (provenance.kind) {
    case 'task-delegation':
      return {
        kind: 'task-delegation',
        parentSessionId: provenance.parentSessionId,
        toolCallId: provenance.toolCallId,
      }
    case 'loop':
      return {
        kind: 'loop-subsession',
        parentSessionId: provenance.parentSessionId,
        loopId: provenance.loopId,
      }
    case 'hook':
      return {
        kind: 'hook',
        parentSessionId: provenance.parentSessionId,
        phase: provenance.phase,
      }
    case 'skill-fork':
      return {
        kind: 'skill-fork',
        parentSessionId: provenance.parentSessionId,
      }
    case 'root':
    case 'thread':
    case 'fork':
    case 'unknown-origin':
    case 'external-agent':
      return {
        kind: 'isolated-continuation',
        sessionId,
        ...(source ? { source } : {}),
      }
  }
}

/** Effective descriptor surface used by both model exposure and live dispatch. */
export function executionToolSurface(context: RunExecutionContext): ToolSurface {
  const capabilities = [
    ...new Set([
      ...(context.clientSurface?.capabilities.filter(
        (capability) => !PROTECTED_CAPABILITIES.has(capability),
      ) ?? []),
      ...context.authority.capabilities,
    ]),
  ]
  const catalogCapabilities = new Set(
    context.clientSurface?.capabilities.filter(
      (capability) => !PROTECTED_CAPABILITIES.has(capability),
    ) ?? [],
  )
  const catalogs = Object.fromEntries(
    Object.entries(context.clientSurface?.catalogs ?? {}).filter(([capability]) =>
      catalogCapabilities.has(capability),
    ),
  )
  return {
    capabilities,
    ...(Object.keys(catalogs).length > 0 ? { catalogs } : {}),
  }
}

/** Durable message provenance for engine-injected invocations. */
export function invocationOrigin(invocation: RunInvocation): string | undefined {
  switch (invocation.kind) {
    case 'channel':
      return invocation.source ?? 'external'
    case 'root':
      return invocation.source
    case 'task-delegation':
      return 'task-delegation'
    case 'loop-subsession':
      return 'loop'
    case 'hook':
      return 'hook'
    case 'skill-fork':
      return 'skill-fork'
    case 'isolated-continuation':
      return invocation.source
  }
}
