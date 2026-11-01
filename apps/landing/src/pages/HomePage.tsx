import { useEffect, useRef } from 'react'
import { Close, DocsRoster, ReleaseDates, Statement } from '@/components/home/HomeSections'
import { HomeLoop } from '@/components/home/HomeLoop'
import { PortalHero } from '@/components/home/PortalHero'
import '../components/home/films.css'

const HEADLINE = 'The Agentic Development Environment'

/**
 * Shows each `.lx-reveal` once it scrolls into view, and never hides it again. The hidden state
 * exists only under `html.reveal-ready` (script, no reduced motion), so every other reader gets
 * the finished page.
 */
function useRevealOnce(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.setAttribute('data-in', '')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
    for (const target of element.querySelectorAll('.lx-reveal')) observer.observe(target)
    return () => observer.disconnect()
  }, [root])
}

/**
 * The homepage in six parts: the portal that opens on the demo film, the statement of what
 * Localix is, the workbenches as a stack of cards that slide over each other, the docs as a
 * roster, the releases as dates, and the close with the wordmark cropped by the page edge.
 */
export function HomePage() {
  const page = useRef<HTMLDivElement>(null)
  useRevealOnce(page)
  return (
    <div ref={page} className="lx-home">
      <PortalHero headline={HEADLINE} />
      <Statement />
      <HomeLoop />
      <DocsRoster />
      <ReleaseDates />
      <Close />
    </div>
  )
}
