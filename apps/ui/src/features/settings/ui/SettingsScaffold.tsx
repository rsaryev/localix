import { createContext, useContext, useId, type ReactNode } from 'react'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * The one container a settings group lives in: a hairline outline and a quiet foreground veil, so the
 * rows of a group read as one object and two groups read as two. It replaces the open rules the
 * groups used to be drawn with, which left a page as one undifferentiated column.
 */
const SCOPE_LABELS = {
  device: 'This device',
  workspace: 'All projects',
  project: 'This project',
  agent: 'Selected agent',
}

const SettingsSectionContext = createContext(false)

export const SETTINGS_CARD =
  'overflow-hidden rounded-md border border-border-faint bg-foreground/[0.02]'

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
  /** A sentence, or a node such as a monospaced path; it sits under the title in the soft tier. */
  description?: ReactNode
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
    <header
      className={cn(
        'flex flex-col items-stretch justify-between gap-3 @xl:flex-row @xl:items-start @xl:gap-4',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-xl leading-7 font-semibold tracking-tight text-foreground text-balance">
          {title}
        </h2>
        {description && (
          <div className="max-w-2xl text-sm leading-5 text-text-soft text-pretty">
            {description}
          </div>
        )}
      </div>
      {actions && (
        // Centred on the title's line, whatever the control's height: a 36px button and a 28px
        // picker sit on the same axis as the title instead of drifting toward the description.
        <div className="flex min-w-0 flex-wrap items-center gap-2 @xl:h-7 @xl:shrink-0 @xl:flex-nowrap @xl:justify-end">
          {actions}
        </div>
      )}
    </header>
  )
}

/**
 * Every settings page: its header, an optional tab strip, then its sections. One geometry for all
 * of them — the same gap under the header and under the tabs, the same space between sections —
 * so moving between pages or tabs never moves the title, the tabs or the first section.
 */
export function SettingsPage({
  title,
  description,
  actions,
  tabs,
  children,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** The page's tab strip, directly under the header. */
  tabs?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-6 text-left">
      <SettingsPageHeader
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(actions === undefined ? {} : { actions })}
      />
      {tabs}
      <div className="min-w-0 space-y-8">{children}</div>
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
  scope,
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
  /** Omit for a single control in the heading: uses compact padding and setting-label type. */
  children?: ReactNode
  className?: string
  /** Stable id used by settings-search to scroll to + flash this section. */
  anchor?: string
  scope?: keyof typeof SCOPE_LABELS
}) {
  const titleId = useId()
  const standaloneControl = children == null
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        SETTINGS_CARD,
        standaloneControl ? 'p-3' : 'space-y-4 p-4',
        '[&_[data-slot=field-label]]:text-sm [&_[data-slot=field-label]]:text-foreground',
        '[&_[data-slot=field-description]]:leading-5 [&_[data-slot=field-description]]:text-text-soft',
        className,
      )}
      data-settings-anchor={anchor}
    >
      <div
        className={cn(
          'flex flex-col items-stretch justify-between gap-3',
          standaloneControl
            ? '@xl:flex-row @xl:items-center @xl:gap-4'
            : '@lg:flex-row @lg:items-start @lg:gap-4',
        )}
      >
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3
              id={titleId}
              className={cn(
                'leading-6 text-foreground',
                standaloneControl ? 'text-sm font-medium' : 'text-base font-semibold',
              )}
            >
              {title}
            </h3>
            {scope && <span className="text-2xs text-text-faint">{SCOPE_LABELS[scope]}</span>}
          </div>
          {description && (
            <p className="max-w-2xl text-xs leading-5 text-text-soft text-pretty">{description}</p>
          )}
        </div>
        {actions && (
          <div
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-2',
              // Beside a section's title the actions ride the title's line (24px), centred on it
              // whatever their own height, so a roll-up and a button stay one group by the title.
              standaloneControl ? '@xl:shrink-0' : '@lg:h-6 @lg:shrink-0 @lg:flex-nowrap',
            )}
          >
            {actions}
          </div>
        )}
      </div>
      <SettingsSectionContext.Provider value={true}>{children}</SettingsSectionContext.Provider>
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
  const inSection = useContext(SettingsSectionContext)
  return <div className={cn(!inSection && [SETTINGS_CARD, 'p-4'], className)}>{children}</div>
}

/**
 * A divided settings list. Inside a section it inherits that section's single outline and fill;
 * standalone lists keep the shared top and bottom rules.
 *
 * The faint border step (`DIVIDED_LIST`) is the ONE weight for an in-page content divider — the
 * rule under a page heading, between setting rows, around a surface. It is deliberately lighter
 * than the soft chrome seam documented in `panel-header.tsx`, which belongs to panel headers,
 * toolbars and status bars: those separate REGIONS, these separate content inside one. The page
 * header used to draw `/20` and the row groups `/25` — the same role at two weights 5% apart,
 * which reads as a mistake rather than a distinction. Do not add a third step.
 */
export function SettingsRows({
  children,
  className,
  role,
}: {
  children: ReactNode
  className?: string
  role?: 'list'
}) {
  const inSection = useContext(SettingsSectionContext)
  return (
    <div
      role={role}
      className={cn(inSection ? 'divide-y divide-border-faint' : DIVIDED_LIST, className)}
    >
      {children}
    </div>
  )
}

/**
 * Shared row rhythm for labels, descriptions and their right-aligned control.
 *
 * `responsive` is the label-beside-control row that stacks on a narrow pane: label above the
 * control until the container is `@xl`, then side by side with the control pushed right. Three
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
          'flex flex-col items-stretch gap-3 @xl:flex-row @xl:items-center @xl:justify-between',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * A row that names one setting and puts its control on the right: the label and its one-line
 * explanation on the left, the control after it, stacking under the label on a narrow pane. The
 * rows of every settings group wrote this out by hand with their own text sizes, so two rows on one
 * page could explain themselves in different type; this fixes the label, the explanation and the
 * gap in one place.
 */
export function SettingsControlRow({
  title,
  description,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <SettingsRow layout="responsive">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="max-w-prose text-xs leading-5 text-text-soft text-pretty">{description}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 @xl:shrink-0">{children}</div>
    </SettingsRow>
  )
}
