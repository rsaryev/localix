import type { SpaceElement } from '../format/document'
import { isSpaceId, newId } from '../format/ids'
import { keyBetween, topKey } from '../format/order'
import type { ElementTypeSpec } from '../registry/contract'
import type { TypeRegistry } from '../registry/registry'
import type { CreateOp, OpResult, UpdateOp } from './contract'
import type { SpaceDraft } from './draft'
import { membersOf, placeFree } from './geometry'

/**
 * The element operations. Each one checks everything it needs BEFORE it writes anything, so a
 * refused operation leaves the board exactly as it was and its batch goes on without it.
 */
export interface OpContext {
  registry: TypeRegistry
  random?: () => number
}

export const refuse = (error: string): OpResult => ({ ok: false, error })

export function createElement(draft: SpaceDraft, op: CreateOp, ctx: OpContext): OpResult {
  const spec = ctx.registry.get(op.type)
  if (!spec)
    return refuse(
      `unknown type "${op.type}"; the types are ${ctx.registry
        .all()
        .map((known) => known.type)
        .join(', ')}`,
    )
  if (op.id !== undefined && !isSpaceId(op.id))
    return refuse(`"${op.id}" is not a valid id: a letter, then letters, digits, - or _`)
  if (op.id !== undefined && draft.taken(op.id)) return refuse(`the id "${op.id}" is taken`)
  const frame = op.in ? draft.elements[op.in] : undefined
  if (op.in && !frame) return missing(draft, op.in)
  if (frame && !ctx.registry.get(frame.type)?.container)
    return refuse(`"${op.in}" is a ${frame.type}, not a frame; "in" takes a frame`)
  if (op.near && !draft.elements[op.near]) return missing(draft, op.near)

  const props = withText(spec, op.props ?? {}, op.text)
  if (typeof props === 'string') return refuse(props)
  const parsed = spec.props.safeParse(props)
  if (!parsed.success) return refuse(`${op.type}: ${reason(parsed.error)}`)

  const natural = spec.measure?.(parsed.data) ?? spec.size
  const size = clampSize(spec, op.w ?? natural.w, op.h ?? natural.h)
  const at =
    op.x !== undefined && op.y !== undefined
      ? { x: op.x, y: op.y }
      : placeFree(draft.document(), size, { within: op.in, near: op.near })
  const id = op.id ?? newId(draft.taken, ctx.random)
  draft.setElement(id, {
    type: op.type,
    ...at,
    ...size,
    z: keyBetween(topKey(Object.values(draft.elements)), null),
    props: parsed.data as Record<string, unknown>,
    ...(op.locked ? { locked: true } : {}),
    ...(op.opacity !== undefined && op.opacity < 1 ? { opacity: op.opacity } : {}),
  })
  return { ok: true, id }
}

export function updateElement(draft: SpaceDraft, op: UpdateOp, ctx: OpContext): OpResult {
  const element = draft.elements[op.id]
  if (!element) return missing(draft, op.id)
  if (element.locked && op.locked !== false)
    // One update both unlocks and changes: an agent read "unlock it first" as three operations
    // (unlock, move, lock again) for what `locked: false` beside the move does in one.
    return refuse(
      `"${op.id}" is locked; add locked: false to this same update to change it (and locked: true in a later one to lock it again)`,
    )
  const next: SpaceElement = { ...element }
  // A change of kind keeps the RECORD — id, stacking, groups, connectors — and only re-reads its
  // props as the new kind's: a delete and a create lost the groups and lifted it to the top.
  const retype = op.type !== undefined && op.type !== element.type

  if (op.props !== undefined || op.text !== undefined || retype) {
    const type = op.type ?? element.type
    const spec = ctx.registry.get(type)
    if (retype && !spec) return refuse(`there is no element type "${type}"`)
    const read = ctx.registry.read(
      element.type,
      element.props,
      draft.document().typeVersions[element.type],
    )
    if (!spec || (!retype && (read.status === 'unknown' || read.status === 'newer')))
      return refuse(
        `"${op.id}" is a ${element.type} this build cannot edit; move or delete it only`,
      )
    const merged: Record<string, unknown> = retype
      ? {}
      : { ...(read.status === 'ok' ? read.props : element.props) }
    for (const [key, value] of Object.entries(op.props ?? {}))
      if (value === null) delete merged[key]
      else merged[key] = value
    const props = withText(spec, merged, op.text)
    if (typeof props === 'string') return refuse(props)
    const parsed = spec.props.safeParse(props)
    if (!parsed.success) return refuse(`${type} ${op.id}: ${reason(parsed.error)}`)
    next.type = type
    next.props = parsed.data as Record<string, unknown>
  }

  const spec = ctx.registry.get(next.type)
  // A content-sized type follows a change of its content; an explicit size still wins.
  const contentChanged = op.props !== undefined || op.text !== undefined || retype
  const natural = contentChanged && spec?.measure ? spec.measure(next.props) : element
  const size = spec ? clampSize(spec, op.w ?? natural.w, op.h ?? natural.h) : null
  next.w = size?.w ?? op.w ?? element.w
  next.h = size?.h ?? op.h ?? element.h
  next.x = op.x ?? element.x
  next.y = op.y ?? element.y
  if (op.locked !== undefined) {
    if (op.locked) next.locked = true
    else delete next.locked
  }
  if (op.opacity !== undefined) {
    if (op.opacity < 1) next.opacity = op.opacity
    else delete next.opacity
  }

  // A frame carries what it holds: members are found where the frame WAS, then moved with it.
  const dx = next.x - element.x
  const dy = next.y - element.y
  if ((dx !== 0 || dy !== 0) && spec?.container)
    for (const member of membersOf(draft.document(), op.id, ctx.registry)) {
      const current = draft.elements[member] as SpaceElement
      draft.setElement(member, { ...current, x: current.x + dx, y: current.y + dy })
    }
  draft.setElement(op.id, next)
  return { ok: true, id: op.id }
}

/** Delete an element with its connectors, or one connector. A frame's contents stay. */
export function deleteRecord(draft: SpaceDraft, id: string): OpResult {
  if (draft.edges[id]) {
    draft.setEdge(id, null)
    return { ok: true, id }
  }
  const element = draft.elements[id]
  if (!element) return missing(draft, id)
  if (element.locked)
    return refuse(`"${id}" is locked; unlock it with an update (locked: false) before deleting it`)
  let connectors = 0
  for (const [edgeId, edge] of Object.entries(draft.edges))
    if (edge.from === id || edge.to === id) {
      draft.setEdge(edgeId, null)
      connectors++
    }
  draft.setElement(id, null)
  return connectors
    ? { ok: true, id, note: `with ${connectors} connector${connectors === 1 ? '' : 's'}` }
    : { ok: true, id }
}

export function missing(draft: SpaceDraft, id: string): OpResult {
  return refuse(
    draft.edges[id]
      ? `"${id}" is a connector; change it with op "edge"`
      : `no element "${id}"; read the board for the ids that exist`,
  )
}

/**
 * `text` as the type understands it: a type with a text FORM reads the whole element from it (a
 * Mermaid sequence), a type with one main text prop gets that prop, any other refuses by name.
 */
function withText(spec: ElementTypeSpec, props: Record<string, unknown>, text?: string) {
  if (text === undefined) return props
  if (spec.fromText) {
    const read = spec.fromText(text)
    return typeof read === 'string' ? `${spec.type} text: ${read}` : { ...props, ...read }
  }
  if (!spec.textProp) return `a ${spec.type} has no text of its own; set its props instead`
  return { ...props, [spec.textProp]: text }
}

function clampSize(spec: ElementTypeSpec, w: number, h: number) {
  return { w: Math.max(spec.minSize?.w ?? 1, w), h: Math.max(spec.minSize?.h ?? 1, h) }
}

function reason(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join('.') || 'props'}: ${issue.message}`)
    .join('; ')
}
