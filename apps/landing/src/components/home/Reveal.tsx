import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { PAGE_SHELL } from '../../lib/shell'

/**
 * Fires the CSS `.reveal` transition once, the first time the element enters
 * the viewport, then stops observing it. One observer per element keeps the
 * callback trivial; the transition itself is compositor-only (see styles.css).
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return ref
}

export function Section({
  id,
  className,
  snap = true,
  reveal = true,
  children,
}: {
  id?: string
  className?: string
  snap?: boolean
  reveal?: boolean
  children: React.ReactNode
}) {
  const ref = useReveal<HTMLElement>()
  return (
    <section
      id={id}
      ref={reveal ? ref : undefined}
      className={cn(
        PAGE_SHELL,
        snap && 'snap-section',
        snap && 'flex min-h-[78svh] flex-col justify-center lg:min-h-[84svh]',
        reveal && 'reveal',
        className,
      )}
    >
      {children}
    </section>
  )
}

/** Observed once as a container; its direct children cascade in on delays. */
export function Stagger({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={cn('reveal-stagger', className)}>
      {children}
    </div>
  )
}
