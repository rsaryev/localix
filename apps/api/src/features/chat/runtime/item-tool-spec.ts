import type { AgentItemStatus } from '@localixai/agent/agents'
import type { ToolItemSpec } from './item-builders'
import type { ItemAccumulatorOptions } from './items'
import { sealToolSpec } from './sealed-items'

const STATUS_RANK: Record<AgentItemStatus, number> = {
  pending: 0,
  running: 1,
  completed: 2,
  failed: 2,
  aborted: 2,
}

/** Fold a tool patch without downgrading status or storing unshielded or unsealed values. */
export function mergeToolItemSpec(options: {
  toolCallId: string
  patch: Partial<ToolItemSpec> & { name: string }
  prev: ToolItemSpec | undefined
  activeVerbFor: (name: string) => string
  opts: ItemAccumulatorOptions
  sanitize: (value: unknown) => unknown
}): ToolItemSpec {
  const { toolCallId, patch, prev, activeVerbFor, opts, sanitize } = options
  // Never downgrade status (pending → running → terminal); merge details/result.
  const status =
    patch.status && (!prev || STATUS_RANK[patch.status] >= STATUS_RANK[prev.status])
      ? patch.status
      : (prev?.status ?? 'pending')
  const presentation = opts.presentationFor?.(patch.name) ?? prev?.presentation
  const spec: ToolItemSpec = {
    toolCallId,
    activeVerb: activeVerbFor(patch.name),
    ...prev,
    ...patch,
    presentation,
    actions: opts.actionsFor ? opts.actionsFor(toolCallId) : prev?.actions,
    standalone:
      opts.standaloneFor?.(patch.name) === true ||
      opts.presentationFor?.(patch.name)?.transcript === 'content' ||
      prev?.standalone,
    // After the spreads, so a patch that carries either field cannot land unshielded. `in` rather
    // than a truthiness check: a patch omitting the key must keep `prev`'s value, and an explicit
    // `undefined`/`null`/`''` must still pass through the sanitizer rather than resurrect `prev`'s.
    ...('input' in patch ? { input: sanitize(patch.input) } : {}),
    ...('details' in patch ? { details: sanitize(patch.details) } : {}),
    status,
  }
  // Last, over the shielded copy: a sealed value must not survive in any field a patch carried.
  return sealToolSpec(spec, presentation?.sealed)
}
