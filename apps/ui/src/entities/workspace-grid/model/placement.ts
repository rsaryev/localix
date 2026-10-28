// Deterministic tab placement: a kind always opens into its ROLE's group,
// regardless of which group was last focused. Pure + unit-testable; the store
// supplies fresh group ids via a callback so this module stays id-generator-free.
import type { CoreWorkItemKind, WorkItemKind } from '@/shared/lib/workItem'
import { activeWorkItemContribution } from './capabilities'
import {
  type GridNode,
  type GroupRole,
  type SplitDir,
  findLeafByRole,
  firstLeaf,
  insertSplit,
  makeLeaf,
  mapLeaves,
} from './tree'

/** Kind → the role of the group it opens into. Two DEFAULT roles: a primary
 *  `editor` area for documents — including the live app preview AND terminals,
 *  which open CENTER STAGE as editor tabs; and one `aux` side panel that stacks
 *  the companion views — chat, source control, task, problems — as TABS. So a
 *  workspace opens as editor + aux; tab strips and one adjustable divider keep
 *  both areas usable without stacking additional panels.
 *  Covers every CORE kind (the Record type rejects a core kind that forgets a
 *  role); subsystem-contributed kinds are placed via the registry in
 *  `roleForKind` and need no entry here. */
const PLACEMENT_POLICY: Record<CoreWorkItemKind, GroupRole> = {
  // Primary editor area — documents + full-surface views.
  file: 'editor',
  diff: 'editor',
  'live-file-change': 'editor',
  'message-replay': 'editor',
  settings: 'editor',
  stats: 'editor',
  'mini-app-view': 'editor',
  'global-search': 'editor',
  // The live preview opens as a TAB in the editor group — center stage, where
  // files open — not its own column.
  preview: 'editor',
  // Terminals open as TABS in the editor group too — the same group the preview
  // opens into, so a terminal lands beside the app it's serving instead of a
  // dedicated bottom strip.
  terminal: 'editor',
  // Aux side panel — companion views, stacked as tabs.
  chat: 'aux',
  // A transcript is a conversation, so it stacks where conversations do.
  transcript: 'aux',
  problems: 'aux',
}

/** How a missing role group is spawned. `aux` is the BASE (the seed leaf, adopted
 *  from the first leaf, holds the chat). `editor` takes the primary share to the
 *  LEFT of the aux panel → default [ editor | aux ]. Each spawn walks UP to the
 *  nearest existing anchor (see `existingAnchorGroup`). `sizes` is in final
 *  tree order [first-child, second-child], which depends on `dir` (before/after). */
const ROLE_SPAWN: Record<
  Exclude<GroupRole, 'aux'>,
  { anchor: GroupRole; dir: SplitDir; sizes: [number, number] }
> = {
  editor: { anchor: 'aux', dir: 'left', sizes: [0.62, 0.38] }, // dir left → [editor(new), aux(base)]
}

export function roleForKind(kind: WorkItemKind): GroupRole {
  // A contribution may declare which default area it belongs to; without one it lands in the
  // primary editor area, which is right for the document-shaped surfaces most of them are. The
  // declaration exists so a conversation-shaped contribution can stack with the chats in `aux`
  // instead of opening center stage — without core learning that mini app's kind.
  // Reserved core kinds always retain their explicit policy.
  const contributed = activeWorkItemContribution(kind)
  if (contributed) return contributed.placement === 'aux' ? 'aux' : 'editor'
  return PLACEMENT_POLICY[kind as CoreWorkItemKind] ?? 'editor'
}

/** Resolve a role group to split off, walking UP the anchor chain to the nearest
 *  EXISTING group instead of creating empty intermediates. `aux` is the
 *  guaranteed base. */
function existingAnchorGroup(
  root: GridNode,
  anchor: GroupRole,
  newId: () => string,
): { root: GridNode; groupId: string } {
  let role = anchor
  while (role !== 'aux' && !findLeafByRole(root, role)) role = ROLE_SPAWN[role].anchor
  return ensureRoleGroup(root, role, newId)
}

/**
 * Ensure the group carrying `role` exists, tagging freshly-created groups with
 * their role. `aux` is adopted from the first leaf (cold-tree fallback; normally
 * already seeded + tagged by chat-sync); other roles split off the nearest
 * existing anchor. Returns the updated tree + the role group's id. `newId` mints
 * collision-free group ids.
 */
function ensureRoleGroup(
  root: GridNode,
  role: GroupRole,
  newId: () => string,
): { root: GridNode; groupId: string } {
  const existing = findLeafByRole(root, role)
  if (existing) return { root, groupId: existing.id }

  if (role === 'aux') {
    const first = firstLeaf(root)
    const tagged = mapLeaves(root, (l) =>
      l.id === first.id ? { ...l, role: 'aux' as GroupRole } : l,
    )
    return { root: tagged, groupId: first.id }
  }

  const spawn = ROLE_SPAWN[role]
  const anchored = existingAnchorGroup(root, spawn.anchor, newId)
  const groupId = newId()
  const next = insertSplit(
    anchored.root,
    anchored.groupId,
    spawn.dir,
    makeLeaf(groupId, [], null, role),
    spawn.sizes,
  )
  return { root: next, groupId }
}

/**
 * Resolve where `kind` should open: the id of its role group, creating that group
 * (and any missing anchor) deterministically. Independent of focus/MRU, so the
 * same kind always lands in the same place.
 */
export function resolveOpenTarget(
  root: GridNode,
  kind: WorkItemKind,
  newId: () => string,
): { root: GridNode; groupId: string } {
  return ensureRoleGroup(root, roleForKind(kind), newId)
}
