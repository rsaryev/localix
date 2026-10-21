import type { WorkItem } from '@/shared/lib/workItem'
import type { EditorState, OpenOptions } from './editor-state'
import { isEphemeralCapable, isEphemeralItem, isPathBacked, isSingleton } from './capabilities'
import { findLeaf } from './tree'
import { capFileTabs, findReusableTabId, resolveRevealEphemeral } from './tab-open-policy'
import { recordTabHistory } from './tab-history'
import { groupOfTab, patchLeaf, gcItems, bumpMru } from './grid-state'

/**
 * Reveal an already-open tab (`existingId`) for a fresh open request: focus it and
 * adopt the reveal's targeting payload (line/column/revealAt). For an exact-id
 * re-open it keeps the incoming item verbatim (original behaviour); for a
 * tiered-identity TWIN (a different textual id addressing the same document) it
 * keeps the existing tab's id + on-disk path so the tab re-reveals without a key
 * remount. Shared by the exact-id dedup and the twin match.
 */
function revealTabState(
  state: EditorState,
  item: WorkItem,
  existingId: string,
  activate: boolean,
  opts: OpenOptions,
): EditorState {
  const leaf = groupOfTab(state.root, existingId)
  if (!leaf) return state
  const prevItem = state.items[existingId]
  const ephemeral = resolveRevealEphemeral(prevItem, item, opts)
  const merged: WorkItem =
    existingId === item.id
      ? { ...item, scope: item.scope ?? prevItem?.scope, ephemeral }
      : {
          ...(prevItem ?? item),
          id: existingId,
          title: prevItem?.title ?? item.title,
          payload: {
            ...prevItem?.payload,
            ...item.payload,
            path: prevItem?.payload?.path ?? item.payload?.path,
          },
          scope: item.scope ?? prevItem?.scope,
          ephemeral,
        }
  const items = { ...state.items, [existingId]: merged }
  if (!activate) return { ...state, items }
  const root = patchLeaf(state.root, leaf.id, (l) => ({
    ...l,
    activeTab: existingId,
    tabHistory: recordTabHistory(l.tabHistory, existingId),
  }))
  // Revealing into a different group while another is maximized would hide the
  // revealed tab — un-maximize so it's actually visible.
  const maximizedGroup =
    state.maximizedGroup && state.maximizedGroup !== leaf.id ? null : state.maximizedGroup
  return {
    ...state,
    root,
    items,
    activeGroup: leaf.id,
    mru: bumpMru(state.mru, leaf.id),
    maximizedGroup,
  }
}

/**
 * Open `item` — or reveal it if it (or a same-document twin) is already open
 * (singletons + any already-open tab). A preview open (ephemeral / `replace`)
 * reuses the target group's single preview slot; `replace` prefers the active
 * tab's slot (single-click preview) when it holds a non-dirty preview.
 */
export function openItemState(
  state: EditorState,
  item: WorkItem,
  opts: OpenOptions = {},
): EditorState {
  const activate = opts.activate ?? true

  // 1. Reveal an existing instance (dedup by id — covers singletons + re-opens).
  if (groupOfTab(state.root, item.id)) return revealTabState(state, item, item.id, activate, opts)

  // 2. Tiered-identity fallback: a DIFFERENT open id that resolves to the same
  //    document (normalized path) — reveal it rather than stacking a duplicate.
  const twinId = findReusableTabId(state, item)
  if (twinId) return revealTabState(state, item, twinId, activate, opts)

  const targetId = opts.group && findLeaf(state.root, opts.group) ? opts.group : state.activeGroup
  // A preview open rides the shared slot: an explicit ephemeral open, or a
  // `replace` (single-click preview) open. An explicit pin (ephemeral:false) is NOT
  // a preview. Singletons never preview.
  const wantPreview =
    ((opts.ephemeral ?? false) || (opts.replace ?? false)) && !isSingleton(item.kind)
  // Stamp the ephemeral pin flag only on kinds that ride the preview slot (cap-
  // driven, not a hardcoded file/diff literal set).
  const nextItem: WorkItem = isEphemeralCapable(item.kind)
    ? { ...item, ephemeral: wantPreview }
    : item

  // `replace` (file-tree click-through): reuse the target group's ACTIVE tab slot
  // when it holds a non-dirty PREVIEW file/diff — the clicked file takes over that
  // slot in place. A pinned or dirty active tab is never clobbered (falls through to
  // the ordinary preview-slot append below).
  let replaceOldId: string | undefined
  if (opts.replace) {
    const target = findLeaf(state.root, targetId)
    const activeTabId = target?.activeTab ?? undefined
    const activeItem = activeTabId ? state.items[activeTabId] : undefined
    if (
      activeItem &&
      activeTabId !== item.id &&
      isPathBacked(activeItem.kind) &&
      !activeItem.isDirty &&
      isEphemeralItem(activeItem)
    ) {
      replaceOldId = activeTabId
    }
  }

  let items = { ...state.items, [item.id]: nextItem }
  const root = patchLeaf(state.root, targetId, (leaf) => {
    let tabs = leaf.tabs
    if (replaceOldId) {
      // Swap the new tab into the replaced slot's position; drop the old id.
      const at = tabs.indexOf(replaceOldId)
      tabs = tabs.filter((id) => id !== replaceOldId)
      const insertAt = at < 0 ? tabs.length : at
      tabs = [...tabs.slice(0, insertAt), item.id, ...tabs.slice(insertAt)]
    } else {
      if (wantPreview) {
        // Replace this group's existing preview slot rather than appending — but
        // never discard a preview with UNSAVED edits (protect dirty work; it just
        // stops being the sole preview until saved/pinned).
        const drop = tabs.filter(
          (id) => items[id] && isEphemeralItem(items[id]) && !items[id].isDirty,
        )
        tabs = tabs.filter((id) => !drop.includes(id))
      }
      tabs = [...tabs, item.id]
    }
    const activeTab = activate ? item.id : (leaf.activeTab ?? item.id)
    tabs = capFileTabs(items, tabs, activeTab, item.id)
    // Record the activation so a later close can return here. Stale ids (evicted/
    // replaced tabs) stay harmless — pickFromHistory only ever returns a survivor.
    const tabHistory = activate ? recordTabHistory(leaf.tabHistory, item.id) : leaf.tabHistory
    return { ...leaf, tabs, activeTab, tabHistory }
  })
  items = gcItems({ ...state, items }, root) // drop evicted preview/replaced/capped records
  // Opening a tab into a non-maximized group while another is maximized would
  // hide it — un-maximize so the new tab is visible.
  const maximizedGroup =
    activate && state.maximizedGroup && state.maximizedGroup !== targetId
      ? null
      : state.maximizedGroup
  return {
    ...state,
    root,
    items,
    activeGroup: activate ? targetId : state.activeGroup,
    mru: activate ? bumpMru(state.mru, targetId) : state.mru,
    maximizedGroup,
  }
}
