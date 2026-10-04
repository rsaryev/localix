import type { ReactNode } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'

/**
 * The title + description block every settings page opens with.
 *
 * Split out of `SettingsPage` because one page — Capabilities — cannot use the
 * full scaffold: its tab strip has to sit directly under the heading and draw
 * the page's only rule. It used to restate the heading markup instead, so the
 * two headings drifted apart in type scale and gutters and the title moved when
 * you navigated between them. The heading is stated here once; a page that
 * needs a different seam passes it, and nothing else is duplicated.
 */
export function SettingsPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  /**
   * What this page can do, on the heading's own line.
   *
   * A slot rather than a row of its own below: a page that stacked its title, its
   * description and then its buttons spent three rows of a screen on saying its own name,
   * and the buttons ended up floating in the gap between the heading and the content they
   * act on.
   */
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1.5">
        <h2 className="text-2xl font-medium tracking-tight text-foreground text-balance sm:text-3xl">
          {title}
        </h2>
        {description && (
          <p className="max-w-2xl text-sm leading-6 text-text-soft text-pretty">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap justify-end gap-2">{actions}</div>}
    </header>
  )
}

export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-6 text-left">
      <SettingsPageHeader
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(actions === undefined ? {} : { actions })}
        className="border-b border-border-faint pb-4"
      />
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
  anchor,
}: {
  title: string
  description?: ReactNode
  /**
   * What this section can do, on its heading's own line — the same slot the page header has.
   *
   * Beside the title rather than under the content: a control that acts on a long list is
   * unreachable at the bottom of one, and a reader who never scrolls that far never learns
   * it exists.
   */
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Stable id used by settings-search to scroll to + flash this section. */
  anchor?: string
}) {
  return (
    <section className={cn('space-y-3', className)} data-settings-anchor={anchor}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-medium text-foreground">{title}</h3>
          {description && (
            <p className="max-w-2xl text-sm leading-6 text-text-soft">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function SettingsSurface({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('border-y border-border-faint py-4', className)}>{children}</div>
}

/**
 * A transparent group of native settings rows, bounded by two quiet rules.
 *
 * The faint border step (`DIVIDED_LIST`) is the ONE weight for an in-page content divider — the
 * rule under a page heading, between setting rows, around a surface. It is deliberately lighter
 * than the soft chrome seam documented in `panel-header.tsx`, which belongs to panel headers,
 * toolbars and status bars: those separate REGIONS, these separate content inside one. The page
 * header used to draw `/20` and the row groups `/25` — the same role at two weights 5% apart,
 * which reads as a mistake rather than a distinction. Do not add a third step.
 */
export function SettingsRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(DIVIDED_LIST, className)}>{children}</div>
}

/**
 * Shared row rhythm for labels, descriptions and their right-aligned control.
 *
 * `responsive` is the label-beside-control row that stacks on a narrow pane: label above the
 * control until the container is `@md`, then side by side with the control pushed right. Three
 * rows wrote that recipe out by hand; a row that needs it now names the layout.
 */
export function SettingsRow({
  children,
  className,
  layout = 'block',
}: {
  children: ReactNode
  className?: string
  layout?: 'block' | 'responsive'
}) {
  return (
    <div
      className={cn(
        'py-3',
        layout === 'responsive' &&
          'flex flex-col items-stretch gap-4 @md:flex-row @md:items-center @md:justify-between',
        className,
      )}
    >
      {children}
    </div>
  )
}
