import type { SpaceDocument, SpaceEdge } from '../format/document'
import { isSpaceId, newId } from '../format/ids'
import type { SpaceOp, OpResult } from './contract'
import { alignElements, arrangeElements, distributeElements } from './arrange'
import { SpaceDraft, type SpacePatch } from './draft'
import {
  createElement,
  deleteRecord,
  missing,
  refuse,
  updateElement,
  type OpContext,
} from './elements'
import { groupElements, ungroupElements } from './groups'
import { stackElements } from './stacking'

/**
 * Apply a batch of operations, pointwise: each one lands or is refused on its own, in order, so a
 * later operation may name what an earlier one created. The result carries one entry per
 * operation and the patch of everything that changed — the history entry and the thing a caller
 * sends to whoever else is looking at the board.
 */
export interface AppliedOps {
  space: SpaceDocument
  results: OpResult[]
  patch: SpacePatch
}

export function applyOps(
  space: SpaceDocument,
  ops: readonly SpaceOp[],
  ctx: OpContext,
): AppliedOps {
  const draft = new SpaceDraft(space)
  const results = ops.map((op) => applyOne(draft, op, ctx))
  return { space: draft.document(), results, patch: draft.patch() }
}

function applyOne(draft: SpaceDraft, op: SpaceOp, ctx: OpContext): OpResult {
  switch (op.op) {
    case 'create':
      return createElement(draft, op, ctx)
    case 'update':
      return updateElement(draft, op, ctx)
    case 'delete':
      return deleteRecord(draft, op.id)
    case 'order':
      return stackElements(draft, op.ids, op.to, ctx)
    case 'group':
      return groupElements(draft, op.ids, op.id, ctx)
    case 'ungroup':
      return ungroupElements(draft, op.id)
    case 'align':
      return alignElements(draft, op.ids, op.edge, ctx)
    case 'distribute':
      return distributeElements(draft, op.ids, op.axis, ctx)
    case 'arrange':
      return arrangeElements(draft, op, ctx)
    case 'connect': {
      for (const end of [op.from, op.to]) if (!draft.elements[end]) return missing(draft, end)
      if (op.from === op.to) return refuse('a connector needs two different elements')
      if (op.id !== undefined && (!isSpaceId(op.id) || draft.taken(op.id)))
        return refuse(`the id "${op.id}" is taken or not a valid id`)
      const existing = Object.entries(draft.edges).find(
        ([, edge]) => edge.from === op.from && edge.to === op.to,
      )
      if (existing)
        return refuse(`"${op.from}" is already connected to "${op.to}" by ${existing[0]}`)
      const { op: _op, id: _id, ...edge } = op
      const id = op.id ?? newId(draft.taken, ctx.random)
      draft.setEdge(id, withoutUndefined(edge) as SpaceEdge)
      return { ok: true, id }
    }
    case 'edge': {
      const edge = draft.edges[op.id]
      if (!edge) return missing(draft, op.id)
      const { op: _op, id: _id, ...changes } = op
      const next: Record<string, unknown> = { ...edge }
      for (const [key, value] of Object.entries(changes))
        if (value === null) delete next[key]
        else if (value !== undefined) next[key] = value
      draft.setEdge(op.id, next as SpaceEdge)
      return { ok: true, id: op.id }
    }
  }
}

function withoutUndefined(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}
