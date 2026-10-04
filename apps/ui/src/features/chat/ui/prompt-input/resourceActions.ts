// Pure builder for the ACTION rows that head a drilled `@`-menu level. The
// composer drill-down renders, at EVERY hierarchy level, the current container
// node's ACTIONS at the top of the list and its drillable CHILDREN below. This is
// the generic, provider-agnostic model that replaces the old two-hidden-gesture
// scheme (Enter = drill / link-leaf, `→` = link-container): a container is now
// linkable from an explicit, visible row, so you can keep drilling AND take an
// action at any level — no dead-end (e.g. a git commit whose files you drill can
// still be linked as a whole from "Link this commit").
//
// Kept apart from the React hook so the actions-vs-children ordering is unit-tested.
import type { ResourceNode, ResourceNodeAction } from '@/shared/api/contracts'

/** A ready-to-run action row heading a drilled level. */
export interface ActionRow {
  /** Stable id for React keys (`<uri>#<actionId>`). */
  id: string
  /** Row label — the verb the user sees ("Link this commit"). */
  label: string
  /** One-line hint shown as the row description. */
  description: string
  /** The exact text to insert into the draft (with NO trailing space — the caller adds it). */
  insert: string
}

/** The default action every node carries when a provider declares none. */
const DEFAULT_LINK: ResourceNodeAction = { id: 'link', label: 'Link this here', kind: 'link' }

/**
 * Action rows for a drilled resource level. `parentUri` is the container the user
 * has drilled INTO (null at the provider roots → no actions). `containerNode` is
 * that node's metadata when known (carries the provider-declared `actions`); when
 * unknown (e.g. a hand-typed URI whose parent listing isn't cached) the default
 * "Link this here" still applies. `linkToken(uri)` maps a container URI to the
 * token to insert (a `localix://resource/chat` node links as its native `@project:`/… token, any
 * other scheme as `@resource:<uri>`).
 */
export function resourceActionRows(
  parentUri: string | null,
  containerNode: ResourceNode | null,
  linkToken: (uri: string) => string,
): ActionRow[] {
  if (!parentUri) return []
  const actions = containerNode?.actions?.length ? containerNode.actions : [DEFAULT_LINK]
  return actions.flatMap((a) =>
    a.kind === 'link'
      ? [
          {
            id: `${parentUri}#${a.id}`,
            label: a.label,
            description: containerNode?.label ?? parentUri,
            insert: linkToken(parentUri),
          },
        ]
      : [],
  )
}
