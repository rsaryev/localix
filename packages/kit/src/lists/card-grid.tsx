import type { ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * Cards in one column, two once the container is wide (`@3xl`). Put it inside an `@container`;
 * its children are `ItemCard`s.
 */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('grid grid-cols-1 gap-x-4 @3xl:grid-cols-2', className)}>{children}</ul>
}

/** A titled group of cards with how many it holds, as one landmark named by its title. */
export function CardGridSection({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="px-2 text-xs font-medium text-text-soft">
        {title}
        {count !== undefined && <span className="ml-1 text-text-faint tabular-nums">{count}</span>}
      </h2>
      <CardGrid>{children}</CardGrid>
    </section>
  )
}
