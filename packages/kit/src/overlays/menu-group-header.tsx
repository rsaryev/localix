/**
 * MenuGroupHeader — the one section-header style for composer menus
 * (SlashCommandMenu categories, AtRefMenu provider groups / Actions / Go
 * deeper). The two menus had drifted (tracking-wide vs -wider, text-faint vs
 * -soft, divider vs none); this pins a single look with an optional divider.
 */
export function MenuGroupHeader({ label, divider = false }: { label: string; divider?: boolean }) {
  return (
    <div role="presentation" aria-hidden="true">
      {/* MENU_LABEL's type and the menu separator's colour, at the composer menus' own row
          inset — so a composer section reads like a dropdown section instead of a third style. */}
      {divider && <div className="mx-1 my-1 h-px bg-border" />}
      <div className="select-none px-2.5 pb-0.5 pt-1 text-2xs font-medium uppercase tracking-wider text-text-faint">
        {label}
      </div>
    </div>
  )
}
