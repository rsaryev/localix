import type { SpaceDocument } from '../format/document'
import { isSpaceId, newId } from '../format/ids'
import { byOrder, keysBetween } from '../format/order'
import type { OpResult } from './contract'
import type { SpaceDraft } from './draft'
import { refuse, type OpContext } from './elements'

/**
 * Groups: a group is an id its members list in `groups`, innermost first, and
 * nothing else. Grouping appends a new OUTERMOST id to every member (so grouping two groups
 * nests them), ungrouping removes one id from every member, and a group whose members were
 * deleted down to one is no group at all — every reader here counts members, never trusts a
 * record, so there is none to go stale.
 */

/** Every group on the board with its members; groups of fewer than two are left out. */
export function groupsOf(space: SpaceDocument): Map<string, string[]> {
  const all = new Map<string, string[]>()
  for (const [id, element] of Object.entries(space.elements))
    for (const group of element.groups ?? []) all.set(group, [...(all.get(group) ?? []), id])
  for (const [group, members] of all) if (members.length < 2) all.delete(group)
  return all
}

/**
 * The group a click on an element selects: its outermost live group, or — while `inside` is
 * one of its groups (the person drilled into it) — the next group within that one.
 */
export function selectionGroup(
  space: SpaceDocument,
  id: string,
  inside: string | null = null,
  live: Map<string, string[]> = groupsOf(space),
): string | null {
  const chain = (space.elements[id]?.groups ?? []).filter((group) => live.has(group))
  const depth = inside ? chain.indexOf(inside) : -1
  const within = depth >= 0 ? chain.slice(0, depth) : chain
  return within.at(-1) ?? null
}

/**
 * The element ids a list of targets stands for: an element for itself, a group for all its
 * members. The first target that is neither is the refusal, by name.
 */
export function resolveTargets(
  draft: SpaceDraft,
  targets: readonly string[],
): { ids: string[] } | { error: OpResult } {
  const live = groupsOf(draft.document())
  const ids = new Set<string>()
  for (const target of targets) {
    if (draft.elements[target]) ids.add(target)
    else if (live.has(target)) for (const member of live.get(target) ?? []) ids.add(member)
    else
      return {
        error: refuse(
          draft.edges[target]
            ? `"${target}" is a connector; this operation takes elements or groups`
            : `no element or group "${target}"; read the board for the ids that exist`,
        ),
      }
  }
  return { ids: [...ids] }
}

export function groupElements(
  draft: SpaceDraft,
  targets: readonly string[],
  wanted: string | undefined,
  ctx: OpContext,
): OpResult {
  const resolved = resolveTargets(draft, targets)
  if ('error' in resolved) return resolved.error
  if (resolved.ids.length < 2) return refuse('a group needs at least two elements')
  const taken = (id: string) => draft.taken(id) || groupsOf(draft.document()).has(id)
  if (wanted !== undefined && (!isSpaceId(wanted) || taken(wanted)))
    return refuse(`the id "${wanted}" is taken or not a valid id`)
  const id = wanted ?? newId(taken, ctx.random)
  for (const member of resolved.ids) {
    const element = draft.elements[member]!
    draft.setElement(member, { ...element, groups: [...(element.groups ?? []), id] })
  }
  gather(draft, resolved.ids, ctx)
  return { ok: true, id, note: `of ${resolved.ids.length}` }
}

/**
 * A new group's members made one run in the stacking order, at its topmost member: a note stacked BETWEEN two members would otherwise sit inside the group on
 * screen and outside it in every reorder. Members already in one run keep their keys, and
 * frames — a layer of their own — are left where they are.
 */
function gather(draft: SpaceDraft, ids: readonly string[], ctx: OpContext) {
  const chosen = new Set(ids)
  const flat = Object.entries(draft.elements)
    .filter(([, element]) => !ctx.registry.get(element.type)?.container)
    .map(([id, element]) => ({ id, ...element }))
    .sort(byOrder)
  const members = flat.filter((element) => chosen.has(element.id))
  const low = members[0]
  const top = members.at(-1)
  if (!low || !top) return
  const rest = flat.filter((element) => !chosen.has(element.id))
  if (!rest.some((element) => element.z > low.z && element.z < top.z)) return
  const below = rest.findLast((element) => element.z < top.z)
  const above = rest.find((element) => element.z > top.z)
  const keys = keysBetween(below?.z ?? null, above?.z ?? null, members.length)
  members.forEach(({ id, ...element }, index) => {
    draft.setElement(id, { ...element, z: keys[index] as string })
  })
}

export function ungroupElements(draft: SpaceDraft, id: string): OpResult {
  const members = groupsOf(draft.document()).get(id)
  if (!members) return refuse(`no group "${id}"; the roster names each element's groups`)
  for (const member of members) {
    const element = draft.elements[member]!
    const groups = (element.groups ?? []).filter((group) => group !== id)
    const { groups: _groups, ...rest } = element
    draft.setElement(member, groups.length ? { ...rest, groups } : rest)
  }
  return { ok: true, id, note: `${members.length} elements let go` }
}
