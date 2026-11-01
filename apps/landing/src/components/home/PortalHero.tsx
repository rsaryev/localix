import { useRef } from 'react'
import { releases } from '../../generated/releases'
import { DemoFilm } from './DemoFilm'
import { CrossX } from './Wordmark'
import { useScrollProgress } from './motion'
import './portal.css'

const latest = releases[0]

/**
 * The first screen is a portal. Two panels meet in the middle over the demo film, and the X of the
 * wordmark stands on their seam as two upright strokes. As the page scrolls, the strokes turn and
 * cross into the X while the wordmark grows and its tracking tightens; then the panels part, the
 * film (whole, framed, never cropped) grows the last few percent into place and the wordmark
 * fades, so the open film is left clean.
 * Every value follows `--p` (scroll position), so scrolling up closes it again.
 *
 * Without script or with reduced motion `--p` is never bound and the CSS default is 1: the
 * portal already open and a single screen tall, so those readers get the finished page.
 */
export function PortalHero({ headline }: { headline: string }) {
  const section = useRef<HTMLElement>(null)
  useScrollProgress(section)
  return (
    <section ref={section} id="intro" className="portal" aria-labelledby="hero-title">
      <div className="portal-stage">
        <div className="portal-image">
          <DemoFilm />
        </div>
        <div className="portal-panel portal-panel-left" aria-hidden="true" />
        <div className="portal-panel portal-panel-right" aria-hidden="true" />
        <h1 id="hero-title" className="portal-title">
          <span className="portal-letters" aria-hidden="true">
            Locali
          </span>
          <CrossX className="portal-x" />
          <span className="sr-only">Localix, {headline}</span>
        </h1>
        <p className="portal-meta portal-meta-tl">{headline}</p>
        {latest && <p className="portal-meta portal-meta-tr">{`v${latest.version}`}</p>}
        <p className="portal-meta portal-meta-bl">Open source, MIT license</p>
      </div>
    </section>
  )
}
