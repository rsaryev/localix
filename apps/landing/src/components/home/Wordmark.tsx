import type { CSSProperties } from 'react'

/**
 * The X of the wordmark, drawn as two strokes: a solid one and an outlined one, you and your
 * agents. Each is a bar turned about the centre and cut flat at the cap height, like the glyph.
 */
export function CrossX({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={`cross-x${className ? ` ${className}` : ''}`}
      style={style}
      viewBox="0 0 132 120"
      aria-hidden="true"
      focusable="false"
    >
      {/* The svg's own viewport cuts the bars flat at the cap height: no clip path, no ids. */}
      <rect className="cross-x-solid" x="56" y="-60" width="20" height="240" />
      <rect className="cross-x-outline" x="56" y="-60" width="20" height="240" />
    </svg>
  )
}

/** The wordmark: LOCALI, then the two-stroke X. Readers get the name from the label. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark${className ? ` ${className}` : ''}`} aria-hidden="true">
      <span className="wordmark-letters">Locali</span>
      <CrossX />
    </span>
  )
}
