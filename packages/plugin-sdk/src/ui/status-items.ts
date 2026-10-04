import type { IconComponent, PluginOwnedContribution } from './contrib'

/**
 * STATUS ITEMS — the one way a plugin puts something in the workbench's persistent chrome.
 *
 * One seam for the titlebar cluster, the composer's context row and the status bar, and it is
 * declarative: a plugin says WHAT it has to show, the host owns how it looks and where it goes.
 * Each place it replaces was a free React surface, and each drifted the way free surfaces do — the
 * contributed titlebar button grew its own height, its own hover and no focus ring beside two host
 * buttons that had all three; the contributed composer pills rendered flat and padless beside the
 * project chip because they took the class string and left the geometry behind.
 *
 * So none of this vocabulary lets a plugin draw. That is the point, not an oversight: one
 * `Component` field and the chrome is a canvas again.
 */

/**
 * How a value reads, always through the `status-*` token family — never a literal colour.
 *
 * The app's ONE tone vocabulary: a transcript notice, a status item, a diagnostics fact and a
 * settings meta line all say `neutral` for "no tone". Each used to have its own word for it
 * (`default`, `muted`), so one fact moved between two surfaces needed a translation table, and
 * the tables disagreed about whether `error` existed.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

/**
 * One entry in a described menu. Data, so it renders in the app's own menu material.
 *
 * Not status-specific despite where it started: the host walks this same shape into a right-click
 * menu and into the dropdown behind a kebab button, which is how those two stay the same menu
 * reached two ways rather than two lists that drift. Anything in the app describing a menu should
 * reach for this rather than hand-rolling menu JSX twice.
 */
export type MenuEntry = MenuActionEntry | MenuSubmenuEntry | MenuSeparatorEntry | MenuHeaderEntry

/** A row that DOES something when chosen — the menu's only leaf. */
export interface MenuActionEntry {
  id: string
  label: string
  /**
   * Leading glyph. The host sizes it — a call site that spells its own size is drift. A glyph that
   * carries a status tone (a mode, a priority, a severity) is `tonedIcon(Icon, tone)`.
   */
  icon?: IconComponent
  /** A keybinding id whose LIVE chord annotates the row, right-aligned. Unbound → no hint. */
  chordId?: string
  /**
   * A short right-aligned value: the count behind a row, the branch a switcher is on, the age of
   * a run. NOT a second sentence — the host truncates it and never wraps.
   *
   * It exists so a plugin stops folding facts into `label` as `Connections (2 live)`, which reads
   * as part of the action's name and breaks the column every other menu in the app aligns on.
   */
  hint?: string
  /**
   * What choosing the row MEANS, as a sentence set under the label. For a menu of choices whose
   * names alone do not say what they do — a permission mode, a reasoning level. It was being
   * folded into `hint`, which sits right-aligned and truncates, so the sentence was cut to
   * "Read-only: the age…" exactly where it explained anything.
   */
  description?: string
  disabled?: boolean
  /**
   * A TOGGLE (on/off per row, a real multi-select): `menuitemcheckbox`. Drawn like `selected` —
   * icon in front, check at the END — so only the role differs; never use it for one choice.
   */
  checked?: boolean
  /**
   * ONE CHOICE among its siblings — a mode, a version, an addressee. A list of choices drawn as
   * `checked` rows announced a multi-select it was not (and, while a checkbox's check sat in the
   * leading slot, lost each mode's icon). A `selected` row keeps its icon in front and marks the
   * chosen one with a check at the END (`menuitemradio`); defined on every row of the list, `true`
   * on the chosen one.
   */
  selected?: boolean
  /**
   * Choosing the row leaves the menu open — for a choice whose answer shows in the menu itself (a
   * submenu trigger's `hint`), where closing would hide what just changed. Inside a submenu the
   * choice returns to the level above, so that answer is what the person sees next.
   */
  keepOpen?: boolean
  /** Destructive — the host gives it the danger treatment its other menus use. */
  danger?: boolean
  /**
   * The one safe, expected next step in this menu: the row carries the same travelling accent as
   * a recommended `Button`. A menu opened from a recommended trigger otherwise lost the mark at
   * exactly the moment the person had to find the act (the plan's Approve row). Never on a
   * permission grant or a destructive row; a disabled row drops it.
   */
  recommended?: boolean
  onSelect: () => void
}

/** A row that OPENS another level. Same vocabulary as an action, minus the act. */
export interface MenuSubmenuEntry {
  id: string
  label: string
  icon?: IconComponent
  hint?: string
  /**
   * The same sentence under the label an action carries. A choice that sometimes opens a level
   * (a permission mode that asks what to do with a waiting plan) otherwise lost the line that
   * said what it does, exactly when it was about to ask.
   */
  description?: string
  disabled?: boolean
  items: readonly MenuEntry[]
  /**
   * The row shown, disabled, when `items` is empty — "No other branches", "Nothing running".
   *
   * A submenu that opens on nothing is the defect this closes: every plugin here builds `items`
   * from live data, and the empty case produced a trigger with a chevron and a blank panel behind
   * it. Saying WHY it is empty is the whole difference between a quiet answer and a broken menu.
   */
  emptyLabel?: string
}

/** A rule between groups. Leading, trailing and doubled ones are dropped by the host. */
export interface MenuSeparatorEntry {
  separator: true
}

/**
 * A group title above the rows it names.
 *
 * The alternative every plugin reached for was a disabled action row, which is a title that can be
 * focused, is announced as an unavailable command, and sits in the same column as the things it
 * labels. A header is none of those. A header with nothing under it is dropped, so building one
 * above a spread of live rows is safe when the spread is empty.
 */
export interface MenuHeaderEntry {
  header: string
}

/**
 * A glyph paired with a number: `↑2` `↓1` beside a branch, `+120` `−34` beside a change count,
 * `⊗3` `⚠2` beside a problem count.
 *
 * Separate from {@link StatusItemState.text} because it is NOT a string. Folding it into one
 * would cost the tone and the `tabular-nums` alignment that stop a live counter from jittering,
 * and would put the arrows' size in the plugin's hands.
 */
export interface StatusMetric {
  icon?: IconComponent
  value: string
  /** What the pair means, for assistive technology — "2 commits ahead". */
  label: string
  tone?: StatusTone
}

/** What a plugin currently has to show. Returned fresh from {@link StatusItemContribution.useItem}. */
export interface StatusItemState {
  /** Accessible name and tooltip. Required — an unlabeled control in the chrome is not one. */
  label: string
  Icon?: IconComponent
  /** A short live string (a branch, a connection name, a count). The host truncates it. */
  text?: string
  metrics?: readonly StatusMetric[]
  /** A number worth counting, or a bare presence dot. */
  badge?: { count: number } | { dot: true }
  tone?: StatusTone
  /** The item's own surface is focused, so the control reads as pressed. */
  active?: boolean
  /** An operation is in flight — the host shows its spinner in place of the badge. */
  busy?: boolean
  /** A keybinding id whose live chord annotates the tooltip. */
  chordId?: string
  /** Primary (left) click. Absent with a `menu` present → the left click opens the menu. */
  onClick?: () => void
  /** Secondary (right) click. */
  menu?: readonly MenuEntry[]
}

export interface StatusItemContribution extends PluginOwnedContribution {
  /** `<plugin>:<item>` — namespace-asserted like every other plugin-chosen identity. */
  id: string
  /**
   * A named place the HOST owns: `'titlebar'`, `'composer'` and `'statusbar'` today.
   *
   * An open string rather than a closed union, exactly like `SessionSurfaceContribution.surface`.
   * A plugin built against a newer SDK simply does not render on an older host, instead of failing
   * to compile or throwing at runtime. An unknown placement shows nothing, quietly.
   */
  placement: string
  /**
   * The hook the host calls, once per bar render, with the session on screen. `null` means the
   * item has nothing to show right now — the host renders no control at all, rather than an empty
   * one.
   *
   * THE PLUGIN'S OBLIGATION: nothing per RENDER. Reading a store or a subscription is free;
   * establishing one subscription on mount is fine and is what a live item is made of. What must
   * not happen is work on every render, or a poll each item starts for itself when the plugin
   * already has that data somewhere else. Twenty plugins means twenty of these on every render of
   * the bar. Same discipline as `FileTreeDecorationContribution.useIndex`.
   */
  useItem: (sessionId: string | null) => StatusItemState | null
}

/**
 * Placements the host renders today.
 *
 * Exported as data so a plugin can name one without spelling a literal, and so the set is
 * discoverable. It is deliberately NOT the type of `placement` — see the field's own note.
 */
export const STATUS_ITEM_PLACEMENTS = ['titlebar', 'composer', 'statusbar'] as const
