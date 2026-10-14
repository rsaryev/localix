import { Fragment, type CSSProperties } from 'react'
import { cn } from '../../lib/cn'

/**
 * A heading whose words rise into place once, on the first paint.
 *
 * The text is ordinary DOM from the server render, so it is readable and indexable before any
 * script runs. The rise is CSS, gated by `html.reveal-ready` (set inline before paint), and moves
 * only a transform inside a clipped word box: no opacity, so the heading still counts as painted.
 */
export function RevealHeading({
  text,
  className,
  delay = 0,
  as: Tag = 'h1',
}: {
  text: string
  className?: string
  delay?: number
  as?: 'h1' | 'h2'
}) {
  const words = text.split(' ')
  return (
    <Tag className={cn('reveal-heading', className)} aria-label={text}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className="reveal-word" aria-hidden="true">
            <span style={{ '--word-delay': `${delay + index * 40}ms` } as CSSProperties}>
              {word}
            </span>
          </span>
          {index < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  )
}
