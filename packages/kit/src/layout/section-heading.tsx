import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

type SectionHeadingProps = {
  title: ReactNode
  /** A sentence, or a node such as a monospaced path; it sits under the title in the soft tier. */
  description?: ReactNode
  /**
   * What this page or section can do, on the heading's own line: a slot rather than a row of its
   * own below, so the buttons sit beside the title and not in the gap before the content they act on.
   */
  actions?: ReactNode
  /** How large it is drawn: `page` opens a screen, `section` heads a part of one. */
  level?: 'page' | 'section'
  /** The heading element, chosen apart from the size: a pane title is an `h1` at section size. */
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}

/**
 * The title, optional description and optional actions that open a page or a section.
 *
 * The Store and Settings each wrote this block by hand at three type sizes and three gaps, so
 * moving between them moved the title. It reflows on its own width (it is its own container), so
 * it needs no container from the host and works in a mini app view. Its parent must be a block or
 * a column flex: an inline-size container collapses inside a shrink-to-fit parent.
 */
export function SectionHeading({
  title,
  description,
  actions,
  level = 'page',
  as,
  className,
}: SectionHeadingProps) {
  const Heading = as ?? (level === 'page' ? 'h2' : 'h3')
  const page = level === 'page'
  return (
    <header data-slot="section-heading" data-level={level} className={cn('@container', className)}>
      <div
        className={cn(
          'flex flex-col items-stretch justify-between gap-3',
          page
            ? '@xl:flex-row @xl:items-start @xl:gap-4'
            : '@lg:flex-row @lg:items-start @lg:gap-4',
        )}
      >
        <div className="min-w-0 space-y-1">
          <Heading
            className={cn(
              'font-semibold text-foreground',
              page ? 'text-xl leading-7 tracking-tight text-balance' : 'text-base leading-6',
            )}
          >
            {title}
          </Heading>
          {description != null && (
            <div
              data-slot="section-heading-description"
              className={cn(
                'max-w-2xl text-text-soft text-pretty',
                page ? 'text-sm leading-5' : 'text-xs leading-5',
              )}
            >
              {description}
            </div>
          )}
        </div>
        {actions != null && (
          // Centred on the title's line, whatever the control's height: a 36px button and a 28px
          // picker sit on the same axis as the title instead of drifting toward the description.
          <div
            data-slot="section-heading-actions"
            className={cn(
              'flex min-w-0 flex-wrap items-center gap-2',
              page
                ? '@xl:h-7 @xl:shrink-0 @xl:flex-nowrap @xl:justify-end'
                : '@lg:h-6 @lg:shrink-0 @lg:flex-nowrap @lg:justify-end',
            )}
          >
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}

export type { SectionHeadingProps }
