import type { MessageBindingContribution, MessageContextBinding } from '@localixai/agent'
import {
  CONTEXT_UNAVAILABLE_KIND,
  type ContextReference,
  type ResolveContext,
} from '@localixai/mini-app-sdk/backend'

import type { ContextManager, ExplicitReferenceStatus } from './manager'
import { HOST_REF_PROVIDER } from './host-ref-resolver'

/**
 * Resolve a message's context bindings through Context Fabric, once, when the turn is accepted.
 *
 * A binding and a Fabric reference are the same thing — a kind, a token, a label, an optional
 * URI and scalar attributes — so the binding's own id becomes the reference id. That removes
 * the two steps that used to sit here: converting to a narrower host `ContextRef` (which dropped
 * any attribute nobody had listed) and matching results back to bindings by token or URI (which
 * needed its own rule for two chips pointing at the same resource).
 *
 * Every binding leaves with content for the model: what it resolved to, or one line saying why
 * it is absent. The user linked it deliberately, and a reference that silently vanished from the
 * turn is the failure the old host fallback existed to prevent — it is now the rule for every
 * kind and every provider, not a second resolution path for some of them.
 */

export interface CaptureContextBindingsInput {
  userId: string
  session: { id: string; projectId: string | null }
  bindings: readonly MessageContextBinding[]
  /** Server-minted effective workspace; filesystem-backed contributions are contained in it. */
  workspace?: ResolveContext['workspace']
  maxBytes: number
  deadlineAtMs?: number
  capturedAt: string
}

export type CapturedResolution = MessageContextBinding['resolution']

/** A binding target read as the Fabric reference it already is. */
export function referenceFromBinding(
  binding: MessageContextBinding,
  scope: ContextReference['scope'],
): ContextReference {
  const { target } = binding
  return {
    version: 1,
    id: binding.id,
    kind: target.kind,
    ...(target.uri ? { uri: target.uri } : {}),
    presentation: { token: target.token, label: target.label },
    freshness: 'resolve-at-send',
    scope,
    ...(target.attributes ? { attributes: target.attributes } : {}),
  }
}

const ABSENCE: Record<Exclude<ExplicitReferenceStatus, 'resolved'>, string> = {
  empty: 'it has no content',
  unsupported: 'nothing in this workspace can read this kind of reference',
  out_of_scope: 'it belongs to another session or project',
  denied: 'the context policy withheld it',
  timeout: 'reading it took too long',
  deadline_exceeded: 'reading it took too long',
  aborted: 'the read was cancelled',
  error: 'reading it failed',
}

function absenceNote(
  binding: MessageContextBinding,
  status: ExplicitReferenceStatus,
  overBudget: boolean,
) {
  // `denied` covers both a policy verdict and a full byte budget; only the second is worth retrying.
  const reason = overBudget
    ? "the message's context budget was already full"
    : status === 'resolved'
      ? 'it has no content'
      : ABSENCE[status]
  return {
    id: `absent:${binding.id}`,
    providerId: HOST_REF_PROVIDER.id,
    providerVersion: HOST_REF_PROVIDER.version,
    scope: 'session' as const,
    kind: CONTEXT_UNAVAILABLE_KIND,
    content: `${binding.target.token}: not included — ${reason}. Read it with your tools if you need it.`,
    sensitivity: 'project' as const,
  }
}

export async function captureContextBindings(
  manager: ContextManager,
  input: CaptureContextBindingsInput,
  signal: AbortSignal,
): Promise<Map<string, CapturedResolution>> {
  const resolutions = new Map<string, CapturedResolution>()
  if (input.bindings.length === 0) return resolutions
  const scope = {
    userId: input.userId,
    sessionId: input.session.id,
    ...(input.session.projectId ? { projectId: input.session.projectId } : {}),
  }
  const result = await manager.resolveExplicit(
    {
      destination: 'chat',
      userId: input.userId,
      sessionId: input.session.id,
      ...(input.session.projectId ? { projectId: input.session.projectId } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      maxBytes: input.maxBytes,
      // Every chip the user added is packed; the byte budget, not an item count, bounds the turn.
      maxItems: input.bindings.length,
      ...(input.deadlineAtMs ? { deadlineAtMs: input.deadlineAtMs } : {}),
    },
    input.bindings.map((binding) => referenceFromBinding(binding, scope)),
    signal,
  )
  const contributionById = new Map(result.contributions.map((item) => [item.id, item]))
  const outcomeById = new Map(
    result.referenceOutcomes.map((outcome) => [outcome.referenceId, outcome]),
  )
  const droppedForBudget = new Set(
    result.dropped.filter((item) => item.reason === 'budget').map((item) => item.id),
  )
  for (const binding of input.bindings) {
    const outcome = outcomeById.get(binding.id)
    const status: ExplicitReferenceStatus = outcome?.status ?? 'unsupported'
    const contributions: MessageBindingContribution[] = (outcome?.contributionIds ?? []).flatMap(
      (id) => {
        const item = contributionById.get(id)
        if (!item) return []
        return [
          {
            id: item.id,
            providerId: item.providerId,
            providerVersion: item.providerVersion,
            scope: item.scope,
            kind: item.kind,
            content: item.content,
            ...(item.revision ? { revision: item.revision } : {}),
            sensitivity: item.sensitivity,
          },
        ]
      },
    )
    // A resolver that could only say why it failed resolved to a reason, not to content.
    const onlyReasons =
      contributions.length > 0 &&
      contributions.every((item) => item.kind === CONTEXT_UNAVAILABLE_KIND)
    resolutions.set(binding.id, {
      status: status === 'resolved' && onlyReasons ? 'error' : status,
      capturedAt: input.capturedAt,
      contributions:
        contributions.length > 0
          ? contributions
          : [
              absenceNote(
                binding,
                status,
                (outcome?.contributionIds ?? []).some((id) => droppedForBudget.has(id)),
              ),
            ],
    })
  }
  return resolutions
}
