import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { HOMEPAGE_HIGHLIGHTS, type HomepageHighlight } from '../../pages/homeHighlights'
import { cn } from '../../lib/cn'
import { FeatureIllustration } from './FeatureIllustration'
import { useOnScreen } from './motion'

/**
 * One card per feature, each a single link. Every scene runs one 8-second loop: an action, its
 * visible result, a hold long enough to read it, and a soft reset. `--n` shifts each card's phase
 * so neighbours never move in unison, and a card off screen pauses where it is.
 */
function FeatureTile({ feature, index }: { feature: HomepageHighlight; index: number }) {
  const tile = useRef<HTMLAnchorElement>(null)
  const onScreen = useOnScreen(tile)
  return (
    <li
      className={cn('bento-cell', feature.wide && 'is-wide')}
      data-feature={feature.id}
      data-paused={!onScreen || undefined}
      style={{ '--n': index } as CSSProperties}
    >
      <Link
        ref={tile}
        to={`/docs/${feature.slug}#${feature.anchor}`}
        className="bento-tile focus-ring"
        aria-labelledby={`feature-${feature.id}-title`}
        aria-describedby={`feature-${feature.id}-description`}
      >
        <div className="bento-copy">
          <h3 id={`feature-${feature.id}-title`}>{feature.title}</h3>
          <p id={`feature-${feature.id}-description`}>{feature.body}</p>
        </div>
        <div className="bento-visual" aria-hidden="true">
          <FeatureIllustration kind={feature.id} />
        </div>
      </Link>
    </li>
  )
}

export function PlatformBento() {
  const grid = useRef<HTMLUListElement>(null)
  const onScreen = useOnScreen(grid, { margin: '0px 0px -10% 0px' })
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (onScreen) setShown(true)
  }, [onScreen])

  return (
    <div className="platform-bento" data-testid="feature-highlights">
      <h2 className="section-heading section-title">
        From an idea to a working change.{' '}
        <span className="text-text-faint">
          Build with your agents. Work with your code, data, and tools in the same place.
        </span>
      </h2>
      <ul ref={grid} className={cn('bento-grid reveal-stagger', shown && 'is-visible')}>
        {HOMEPAGE_HIGHLIGHTS.map((feature, index) => (
          <FeatureTile key={feature.id} feature={feature} index={index} />
        ))}
      </ul>
    </div>
  )
}
