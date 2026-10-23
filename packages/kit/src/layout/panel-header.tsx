import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { SectionLabel } from './section-label'

type PanelHeaderProps = Omit<ComponentPropsWithoutRef<'header'>, 'title'> & {
  title: ReactNode
  /** Optional decorative glyph rendered on the same geometry as the title. */
  icon?: ReactNode
  /** Passive counts/status kept out of the interactive action group. */
  summary?: ReactNode
  actions?: ReactNode
  /** Accessible name for the trailing action group. Derived from string titles by default. */
  actionsLabel?: string
  /** Divider token: `sidebar` (rail sections) or `content` (editor/inspector panels). */
  tone?: 'sidebar' | 'content'
}

/**
 * The section-header row that sits at the top of a sidebar section or panel
 * (Files, Search, Databases, Projects…). One source of truth for the
 * semantic panel-header height + workbench gutter + bottom divider + title
 * typography, so every
 * section that swaps into the same rail slot keeps a pixel-stable header row
 * ("everything aligns to one grid"). Actions go in the right-hand slot.
 *
 * Pass a string `title` for the canonical uppercase `SectionLabel` look, or a
 * ReactNode when the title needs extra chrome (badges, dynamic content).
 *
 * SEAM CONVENTION (repo-wide): structural chrome seams — inter-panel edges,
 * panel/section header rows, toolbars, and status/footer bars — use a single
 * soft weight: `border-border/60` in content/editor areas (the `content` tone
 * here) and solid `border-sidebar-border` inside sidebar/rail chrome (the
 * `sidebar` tone). `/60` reads as a soft-native line yet stays visible on the
 * light theme (≈ `border-subtle`). Do NOT invent other opacity steps
 * (/15,/30,/40,/50,/55,/62,/70) for these seams. Component-internal borders
 * (cards, chips, inputs, popovers/dialogs, table grid cells, diff hunk rows)
 * keep their own weights — they are not chrome seams.
 */
export const PanelHeader = forwardRef<HTMLElement, PanelHeaderProps>(function PanelHeader(
  { title, icon, summary, actions, actionsLabel, tone = 'sidebar', className, ...props },
  ref,
) {
  const hasTrailing = summary != null || actions != null

  return (
    <header
      ref={ref}
      data-slot="panel-header"
      className={cn(
        'flex h-[var(--panel-header-height)] shrink-0 select-none items-center gap-2 border-b px-(--workbench-gutter)',
        tone === 'content' ? 'border-border-soft' : 'border-sidebar-border',
        className,
      )}
      {...props}
    >
      <div data-slot="panel-header-title" className="flex min-w-0 flex-1 items-center gap-1.5">
        {icon != null && (
          <span aria-hidden="true" className="flex shrink-0 text-text-faint">
            {icon}
          </span>
        )}
        {typeof title === 'string' ? (
          <SectionLabel
            as="span"
            size="xs"
            className="min-w-0 truncate tracking-wide text-text-soft"
          >
            {title}
          </SectionLabel>
        ) : (
          title
        )}
      </div>
      {hasTrailing && (
        <div
          data-slot="panel-header-trailing"
          // No `shrink-0` here: it cancelled the `min-w-0` beside it, so a long
          // summary pushed the title out of the header instead of truncating
          // itself. The actions group below keeps its own `shrink-0`, which is
          // what must never shrink.
          className="ml-auto flex max-w-full min-w-0 items-center gap-1.5"
        >
          {summary != null && (
            <div data-slot="panel-header-summary" className="flex min-w-0 items-center gap-0.5">
              {summary}
            </div>
          )}
          {actions != null && (
            <div
              data-slot="panel-header-actions"
              role="group"
              aria-label={
                actionsLabel ?? (typeof title === 'string' ? `${title} actions` : 'Panel actions')
              }
              className="flex shrink-0 items-center gap-0.5"
            >
              {actions}
            </div>
          )}
        </div>
      )}
    </header>
  )
})
PanelHeader.displayName = 'PanelHeader'

export type { PanelHeaderProps }
