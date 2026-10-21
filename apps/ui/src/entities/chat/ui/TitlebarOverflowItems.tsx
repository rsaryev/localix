import type { StatusItemContribution, StatusItemState } from '@localixai/plugin-sdk/ui'

import { StatusItemBoundary, useStatusItemState } from '@/shared/contrib/statusItems'
import { Chip } from '@localixai/kit/chip'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { isMenuAction, normalizeMenuEntries } from '@localixai/kit/menu-entries'
import { pluginMenuEntries, statusItemMenuEntries } from '@/shared/ui/status-item-menu'

/**
 * The items the titlebar could not fit, as menu rows.
 *
 * Each row still asks its plugin what it currently has, so the menu shows live labels rather
 * than the names they had when they were last visible. Its own component per item for the same
 * reason the visible ones have one: `useItem` is a hook, and several in one component would make
 * every plugin share one hook order.
 *
 * ── EVERY ROW DOES SOMETHING ON ONE CLICK ───────────────────────────────────────
 * A row used to be a sub-menu trigger, always, so a plugin whose whole offer is "open me" needed
 * two clicks and a hover to reach it — and clicking the row itself did nothing at all, which is
 * indistinguishable from a dead menu. What decides the shape now is what the item actually has:
 *
 *   one thing to do   → a plain row that RUNS it (the common case: `Open Reader`);
 *   several           → a sub-menu holding the same entries a right-click on the glyph opens.
 *
 * Both forms answer a single click, and neither is a demotion: not fitting is a layout accident,
 * so an item keeps everything it had on the bar. The host's own `Plugin settings…` row is not
 * what makes an item "several" — an item would otherwise never be simple, since every item has
 * that row. It travels with the sub-menu when there is one and is reachable from the glyph's own
 * right-click otherwise.
 *
 * Each row carries the same boundary its inline twin has, and for a stronger reason. `useItem` is
 * the plugin's own hook either way, but the inline copy sits under `StatusItems`' boundary while
 * this one hangs off a portalled menu — so a plugin that throws HERE unwound past the whole
 * workbench to the route's `errorElement`, which replaced the window with a crash screen and
 * journalled it as "Route failed". Not fitting must not be the difference between one dead glyph
 * and a dead route.
 */
export function TitlebarOverflowItems({
  items,
  sessionId,
}: {
  items: readonly StatusItemContribution[]
  sessionId: string | null
}) {
  return (
    <>
      {items.map((contribution) => (
        <StatusItemBoundary key={contribution.id} itemId={contribution.id}>
          <OverflowRow contribution={contribution} sessionId={sessionId} />
        </StatusItemBoundary>
      ))}
    </>
  )
}

/**
 * The item's OWN offer, as the rows a person could actually choose.
 *
 * `pluginMenuEntries` is the single source for where the plugin's half ends — asking it beats
 * measuring the built menu, which is what this did and got wrong: it looked for the FIRST
 * separator and called everything above it the plugin's. True only of a one-section menu, so
 * every plugin that groups its rows (Git, Reader, Database, API, Learning, Trading) had its whole
 * list dropped the moment its glyph stopped fitting, replaced by a row that looked like it worked.
 *
 * Separators and headers do not count: an item whose menu is `Open X` under a title still has ONE
 * thing to do, and a submenu for it would be a panel holding a single row.
 */
function chooseableRows(state: StatusItemState) {
  return normalizeMenuEntries(pluginMenuEntries(state)).filter(
    (entry) => isMenuAction(entry) || 'items' in entry,
  )
}

function OverflowRow({
  contribution,
  sessionId,
}: {
  contribution: StatusItemContribution
  sessionId: string | null
}) {
  const state = useStatusItemState(contribution, sessionId)
  if (!state) return null

  const rows = chooseableRows(state)
  const only = rows.length === 1 ? rows[0] : undefined

  // One thing to do — the row IS that thing. `onSelect` rather than `onClick`: Radix closes the
  // menu after a select, and a menu that stayed open behind the workspace it just opened is the
  // other half of "the row did nothing".
  if (only && isMenuAction(only) && !only.disabled) {
    return (
      <DropdownMenuItem onSelect={() => only.onSelect()}>
        <OverflowRowBody state={state} />
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <OverflowRowBody state={state} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <MenuEntries entries={statusItemMenuEntries(state)} family="dropdown" />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Glyph, name, live text, badge — the same reading order the bar gives the item it replaced. */
function OverflowRowBody({ state }: { state: StatusItemState }) {
  return (
    <>
      {state.Icon && <state.Icon className="size-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{state.label}</span>
      {state.text && <span className="shrink-0 truncate text-text-faint">{state.text}</span>}
      {state.badge && 'count' in state.badge ? (
        // The count is the reason a hidden item is worth finding, so it survives the fold.
        <Chip tone="accent" size="counter" className="shrink-0 font-semibold leading-none">
          {state.badge.count > 99 ? '99+' : state.badge.count}
        </Chip>
      ) : null}
    </>
  )
}
