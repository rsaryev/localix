import type { SpaceDocument, SpaceEdge, SpaceElement } from './document'
import { byOrder } from './order'
import { SPACE_FORMAT, SPACE_VERSION } from './schema'

/**
 * Write a document as its ONE canonical text.
 *
 * The file lives in the project and is read in git diffs, so the same board must always produce
 * the same bytes: known keys in a fixed order, unknown keys after them, elements in stacking order,
 * connectors by id, geometry rounded to whole pixels (a drag leaves `412.6000000001` otherwise, and
 * every save rewrote every coordinate). A read of the written text gives the same document back,
 * which the store relies on to tell its own write from an outside edit.
 */
const ELEMENT_KEYS = [
  'type',
  'x',
  'y',
  'w',
  'h',
  'z',
  'locked',
  'opacity',
  'groups',
  'props',
] as const
const EDGE_KEYS = [
  'from',
  'to',
  'fromSide',
  'toSide',
  'label',
  'route',
  'start',
  'end',
  'stroke',
  'color',
] as const

export function serializeSpace(space: SpaceDocument): string {
  const elements: Record<string, unknown> = {}
  const ordered = Object.entries(space.elements)
    .map(([id, element]) => ({ id, ...element }))
    .sort(byOrder)
  for (const { id, ...element } of ordered) elements[id] = writeElement(element)
  for (const [id, raw] of Object.entries(space.raw.elements)) elements[id] = raw

  const edges: Record<string, unknown> = {}
  for (const id of Object.keys(space.edges).sort())
    edges[id] = inKeyOrder(space.edges[id] as SpaceEdge, EDGE_KEYS)
  for (const [id, raw] of Object.entries(space.raw.edges)) edges[id] = raw

  const used = new Set(
    [...Object.values(space.elements), ...Object.values(space.raw.elements)].flatMap((value) => {
      const type = (value as { type?: unknown }).type
      return typeof type === 'string' ? [type] : []
    }),
  )
  const types: Record<string, number> = {}
  for (const type of [...used].sort()) {
    const version = space.typeVersions[type]
    if (version !== undefined) types[type] = version
  }

  const file = { format: SPACE_FORMAT, version: SPACE_VERSION, types, elements, edges }
  return `${JSON.stringify({ ...file, ...space.extra }, null, 2)}\n`
}

function writeElement(element: SpaceElement): Record<string, unknown> {
  const rounded = {
    ...element,
    x: Math.round(element.x),
    y: Math.round(element.y),
    w: Math.max(1, Math.round(element.w)),
    h: Math.max(1, Math.round(element.h)),
  }
  if (!rounded.locked) delete rounded.locked
  // The defaults are the absence of the key: an opaque, ungrouped element writes neither.
  if (rounded.opacity === undefined || rounded.opacity >= 1) delete rounded.opacity
  else rounded.opacity = Math.round(rounded.opacity * 100) / 100
  if (!rounded.groups?.length) delete rounded.groups
  return inKeyOrder(rounded, ELEMENT_KEYS)
}

/** Known keys first in their fixed order, then any others in the order they came. */
function inKeyOrder<T extends object>(record: T, keys: readonly string[]): Record<string, unknown> {
  const source = record as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key]
  for (const [key, value] of Object.entries(source))
    if (!keys.includes(key) && value !== undefined) out[key] = value
  return out
}
