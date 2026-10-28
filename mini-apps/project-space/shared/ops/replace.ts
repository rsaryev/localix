import type { SpaceDocument } from '../format/document'
import type { TypeRegistry } from '../registry/registry'
import type { SpaceOp } from './contract'

/**
 * Find and replace across the board's own words: a note's text, a shape's label, a frame's title,
 * a connector's label. The phrase is matched as written, ignoring case, wherever it appears.
 *
 * What a type holds as structure is left alone — a flowchart's or a sequence's text is a diagram
 * (`fromText`), and a reference's path names a file (`claims`); rewriting either as words would
 * break it. Each change is one `update` or `edge` operation, so one undo takes all of them back.
 */
export function replaceOps(
  space: SpaceDocument,
  registry: TypeRegistry,
  find: string,
  replacement: string,
): { ops: SpaceOp[]; count: number } {
  if (!find) return { ops: [], count: 0 }
  const pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu')
  let count = 0
  const swap = (text: string) => {
    const hits = text.match(pattern)?.length ?? 0
    count += hits
    return hits ? text.replace(pattern, () => replacement) : null
  }
  const ops: SpaceOp[] = []
  for (const [id, element] of Object.entries(space.elements)) {
    const spec = registry.get(element.type)
    if (!spec?.textProp || spec.fromText || spec.claims || element.locked) continue
    const read = registry.read(element.type, element.props, space.typeVersions[element.type])
    if (read.status !== 'ok') continue
    const current = read.props[spec.textProp]
    const next = swap(typeof current === 'string' ? current : '')
    if (next !== null) ops.push({ op: 'update', id, props: { [spec.textProp]: next } })
  }
  for (const [id, edge] of Object.entries(space.edges)) {
    const next = edge.label ? swap(edge.label) : null
    if (next !== null) ops.push({ op: 'edge', id, label: next })
  }
  return { ops, count }
}
