import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import type { extractHeadings } from '../docsNav'

type Heading = ReturnType<typeof extractHeadings>[number]

/**
 * Scroll-spy over the rendered headings. The root margin puts the "current"
 * band near the top of the viewport, so the highlighted entry is the section
 * you are reading rather than the one furthest down the screen.
 */
function useActiveHeading(headings: Heading[]) {
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  useEffect(() => {
    if (headings.length < 2) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length > 0) setActiveHeading(visible[0].target.id)
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    )
    for (const heading of headings) {
      const element = document.getElementById(heading.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [headings])
  return activeHeading
}

/**
 * The right rail. Carries the same sticky offset as the sidebar rail so the two
 * pin on one line; a single
 * heading is not a table of contents, so it renders nothing.
 */
export function DocsTableOfContents({ headings }: { headings: Heading[] }) {
  const activeHeading = useActiveHeading(headings)
  if (headings.length < 2) return null

  return (
    <nav aria-label="On this page" className="docs-toc sticky top-8 hidden h-fit lg:block">
      <p className="mb-3 text-xs font-medium text-text-faint">On this page</p>
      <ul className="space-y-1 border-l border-border-subtle">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              aria-current={activeHeading === heading.id ? 'location' : undefined}
              className={cn(
                '-ml-px block w-full border-l py-1 text-left text-sm transition-colors',
                heading.depth === 2 ? 'pl-3' : 'pl-6 text-xs',
                activeHeading === heading.id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-text-soft hover:border-control-border-hover hover:text-foreground',
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
