/**
 * The canonical accent style for the SELECTED / keyboard-active row in a
 * list-picker (model picker, session switcher, quick-open, command palette,
 * @-ref menu, …). Uses the sidebar-accent surface — the accent look the model
 * picker established — instead of a flat grey, so selection reads clearly in
 * both light and dark.
 *
 * cmdk-based palettes encode this on the shared `CommandItem` primitive
 * (`shared/ui/command.tsx`) via `data-selected:` variants; non-cmdk menus that
 * track their own active index (e.g. AtRefMenu) apply this constant directly.
 */
export const SELECTED_ROW =
  'lx-selected-row bg-sidebar-accent text-sidebar-foreground shadow-(--shadow-raised)'

/**
 * The shared ROW frame for non-cmdk composer menus (SlashCommandMenu, AtRefMenu)
 * — same gap/padding/radius so the two menus can't drift apart again. Compose
 * with `SELECTED_ROW` when active. Pointer movement updates the active index, so
 * a second CSS-only hover highlight can never appear while keyboard scrolling.
 */
export const MENU_ROW =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-(--dur-instant)'
