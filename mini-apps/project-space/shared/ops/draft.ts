import type { SpaceDocument, SpaceEdge, SpaceElement } from '../format/document'

/**
 * A board being changed, and the record of what changed.
 *
 * Operations write through a draft; the draft remembers each record's value BEFORE its first
 * change in the batch. The resulting patch — every touched record as [before, after] — is the
 * whole history entry: undo writes the befores, redo the afters, and a batch of five hundred drag
 * steps is still one entry because only the first and last values of a record are kept
 * The base document is never mutated.
 */
export interface SpacePatch {
  elements: Record<string, [SpaceElement | null, SpaceElement | null]>
  edges: Record<string, [SpaceEdge | null, SpaceEdge | null]>
}

export class SpaceDraft {
  readonly elements: Record<string, SpaceElement>
  readonly edges: Record<string, SpaceEdge>
  private readonly before = {
    elements: new Map<string, SpaceElement | null>(),
    edges: new Map<string, SpaceEdge | null>(),
  }

  constructor(private readonly base: SpaceDocument) {
    this.elements = { ...base.elements }
    this.edges = { ...base.edges }
  }

  /** Taken ids: elements and connectors share one namespace, raw records included. */
  taken = (id: string) =>
    id in this.elements ||
    id in this.edges ||
    id in this.base.raw.elements ||
    id in this.base.raw.edges

  setElement(id: string, value: SpaceElement | null) {
    if (!this.before.elements.has(id)) this.before.elements.set(id, this.elements[id] ?? null)
    if (value) this.elements[id] = value
    else delete this.elements[id]
  }

  setEdge(id: string, value: SpaceEdge | null) {
    if (!this.before.edges.has(id)) this.before.edges.set(id, this.edges[id] ?? null)
    if (value) this.edges[id] = value
    else delete this.edges[id]
  }

  /** The document as it now is; the base is untouched. */
  document(): SpaceDocument {
    return { ...this.base, elements: this.elements, edges: this.edges }
  }

  patch(): SpacePatch {
    const patch: SpacePatch = { elements: {}, edges: {} }
    for (const [id, before] of this.before.elements) {
      const after = this.elements[id] ?? null
      if (!same(before, after)) patch.elements[id] = [before, after]
    }
    for (const [id, before] of this.before.edges) {
      const after = this.edges[id] ?? null
      if (!same(before, after)) patch.edges[id] = [before, after]
    }
    return patch
  }
}

export const isEmptyPatch = (patch: SpacePatch) =>
  Object.keys(patch.elements).length === 0 && Object.keys(patch.edges).length === 0

/**
 * Write one side of a patch: 0 undoes it, 1 redoes it. A record someone changed since the patch
 * was made (the agent edited the note the person is undoing) is left as it is and named in
 * `conflicts` — undo reverses YOUR change, never overwrites a newer one.
 */
export function applyPatch(space: SpaceDocument, patch: SpacePatch, side: 0 | 1) {
  const draft = new SpaceDraft(space)
  const conflicts: string[] = []
  const expected = side === 0 ? 1 : 0
  for (const [id, values] of Object.entries(patch.elements)) {
    if (!same(space.elements[id] ?? null, values[expected])) conflicts.push(id)
    else draft.setElement(id, values[side])
  }
  for (const [id, values] of Object.entries(patch.edges)) {
    if (!same(space.edges[id] ?? null, values[expected])) conflicts.push(id)
    else draft.setEdge(id, values[side])
  }
  return { space: draft.document(), conflicts }
}

/** Records are plain JSON; key order does not matter to equality. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined)
  const keysB = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) =>
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}
