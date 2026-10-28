import type { SpaceDocument } from '../../shared/format/document'
import type { SpaceOp } from '../../shared/ops/contract'
import { spaceTypes } from '../../shared/types'

/**
 * One element turned into another kind, as the whiteboards' "switch type": a sticky note becomes
 * a shape in a flow, a shape's label becomes free text. It keeps its id, place and size, its text,
 * the look both kinds share (colour, face, alignment), its stacking, its groups and its
 * connectors: the operation changes the kind of the same record (`update` with `type`).
 */
export const SWITCHABLE = ['note', 'shape', 'text'] as const
export type Switchable = (typeof SWITCHABLE)[number]

export const isSwitchable = (type: string): type is Switchable =>
  (SWITCHABLE as readonly string[]).includes(type)

const CARRIED = ['color', 'font', 'align', 'valign', 'ink'] as const

export function switchTypeOps(space: SpaceDocument, id: string, to: Switchable): SpaceOp[] | null {
  const element = space.elements[id]
  if (!element || element.locked || element.type === to || !isSwitchable(element.type)) return null
  const from = spaceTypes.get(element.type)
  const target = spaceTypes.get(to)
  const read = spaceTypes.read(element.type, element.props, space.typeVersions[element.type])
  if (!from || !target || read.status !== 'ok') return null
  const carried = from.textProp ? read.props[from.textProp] : undefined
  const text = typeof carried === 'string' ? carried : ''
  const props: Record<string, unknown> = {}
  for (const prop of CARRIED) {
    if (read.props[prop] === undefined) continue
    const tried = spaceTypes.read(to, { ...props, [prop]: read.props[prop] })
    if (tried.status === 'ok' && tried.props[prop] === read.props[prop])
      props[prop] = read.props[prop]
  }
  // One update that changes the kind: the record — id, stacking, groups, connectors — stays.
  return [{ op: 'update', id, type: to, text, props }]
}
