import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

export interface SectionItem {
  id: string
  label: string
}

/**
 * A fixed vertical "chain" of dots on the right edge — one per page section,
 * connected by a thin line. Click a dot to smooth-scroll to that section; the
 * active one (by scroll position) is filled. Desktop-only; the whole 1.5rem
 * dot target sits inside the section gutter (`lg:px-10`) so it never overlaps
 * the content column. Replaces the section links the old header carried.
 */
export function SectionNav({ sections }: { sections: SectionItem[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [sections])

  const go = (id: string) => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <nav
      aria-label="Sections"
      className="fixed right-2 top-1/2 z-30 hidden -translate-y-1/2 xl:block"
    >
      <ul className="relative flex flex-col items-center gap-3.5 py-1">
        {sections.map((s) => {
          const on = active === s.id
          return (
            <li key={s.id} className="relative z-10">
              <button
                type="button"
                onClick={() => go(s.id)}
                aria-current={on ? 'location' : undefined}
                aria-label={s.label}
                className="group flex size-6 items-center justify-center rounded-full focus-ring"
              >
                <span
                  className={cn(
                    'block size-2 rounded-full border transition-[transform,background-color,border-color] duration-300',
                    on
                      ? 'scale-[1.35] border-foreground bg-foreground'
                      : 'border-text-faint bg-background hover:border-foreground',
                  )}
                />
                {/* hover label, to the left of the dot */}
                <span
                  className={cn(
                    'pointer-events-none absolute right-6 whitespace-nowrap rounded-md border border-border-subtle bg-surface-raised px-2 py-0.5 text-xs shadow-[var(--shadow-soft)] transition-opacity duration-150',
                    on ? 'text-foreground' : 'text-text-soft',
                    'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                  )}
                >
                  {s.label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <span
        className="pointer-events-none absolute left-1/2 top-3 bottom-3 -z-10 w-px -translate-x-1/2 bg-[color-mix(in_oklch,var(--border),transparent_30%)]"
        aria-hidden
      />
    </nav>
  )
}
