import type { EdgeRecord, ElementRecord } from './schema'

/**
 * The board in memory: the file's records keyed by id, with every element given a stacking key.
 *
 * Ids are the map keys and appear nowhere else, so an element can never disagree with its own
 * key. `typeVersions` keeps the version the file declared for types this build cannot upgrade —
 * an unknown type, or one written by a newer build — so writing the board back does not relabel
 * props it never understood. `extra` carries top-level keys this version does not know, and `raw`
 * the records that could not be read at all (an element without a size), so a save keeps them for
 * a person to repair instead of deleting what the board could not draw.
 */
export interface SpaceElement extends ElementRecord {
  z: string
  props: Record<string, unknown>
}

export type SpaceEdge = EdgeRecord

export interface SpaceDocument {
  elements: Record<string, SpaceElement>
  edges: Record<string, SpaceEdge>
  typeVersions: Record<string, number>
  extra: Record<string, unknown>
  raw: { elements: Record<string, unknown>; edges: Record<string, unknown> }
}

/** A fault found reading the file or applying an operation, located by a dotted path. */
export interface SpaceIssue {
  path: string
  message: string
}

export function emptySpace(): SpaceDocument {
  return { elements: {}, edges: {}, typeVersions: {}, extra: {}, raw: { elements: {}, edges: {} } }
}
