import type { SpaceDocument } from '../../shared/format/document'
import { groupsOf, selectionGroup } from '../../shared/ops/groups'

/**
 * The selection as a person means it. A click or a drag-select on a grouped element takes the
 * whole group; clicking an element of the selected group AGAIN enters the group and takes the
 * next level in (a single-click drill-in), so a group is one thing
 * until the person reaches inside it. `entered` is the group reached into, or null.
 */
export function withGroups(
  space: SpaceDocument,
  ids: Iterable<string>,
  entered: string | null,
): Set<string> {
  const live = groupsOf(space)
  const out = new Set<string>()
  for (const id of ids) {
    out.add(id)
    const group = selectionGroup(space, id, entered, live)
    for (const member of (group && live.get(group)) || []) out.add(member)
  }
  return out
}

/**
 * A click on an element that is already selected as part of its group: the group to enter and
 * the selection one level in — or null when the click reaches into nothing.
 */
export function drillInto(
  space: SpaceDocument,
  id: string,
  selected: ReadonlySet<string>,
  entered: string | null,
): { entered: string; selection: Set<string> } | null {
  const live = groupsOf(space)
  const group = selectionGroup(space, id, entered, live)
  const members = group ? live.get(group) : undefined
  if (!group || !members || members.length !== selected.size) return null
  if (!members.every((member) => selected.has(member))) return null
  return { entered: group, selection: withGroups(space, [id], group) }
}

/** The groups the selection holds WHOLE, at the level a click selects — what ungroup lets go. */
export function selectedGroups(
  space: SpaceDocument,
  selected: ReadonlySet<string>,
  entered: string | null,
): Map<string, string[]> {
  const live = groupsOf(space)
  const out = new Map<string, string[]>()
  for (const id of selected) {
    const group = selectionGroup(space, id, entered, live)
    const members = group ? live.get(group) : undefined
    if (group && members?.every((member) => selected.has(member))) out.set(group, members)
  }
  return out
}

/** Whether a selection still lies inside the entered group; leaving it lets go of the group. */
export function staysInside(
  space: SpaceDocument,
  selection: ReadonlySet<string>,
  entered: string | null,
): boolean {
  if (!entered) return true
  const members = new Set(groupsOf(space).get(entered) ?? [])
  return selection.size > 0 && [...selection].every((id) => members.has(id))
}
