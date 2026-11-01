import { useId } from 'react'

/** Archivo's X at weight 500, width 125, in font units with the cap top at y = 0. */
const X_PATH =
  'M0 686.8L332.2 330.3L29.7 0H199L413.4 240.6H424.1L642 0H800.5L499.2 324L832.7 686.8H663.4L417.6 413.1H406.3L158.5 686.8Z'
/**
 * The trail: the X's "\" stroke carried on up and to the left, toward the bird, narrowing from the
 * stroke's full width to a point and fading as it goes, as if the bird had taken off from the X.
 */
const TRAIL_PATH = 'M29.7 0H199L-733.3 -918.7Z'

/**
 * LOCALIX under the bird: small, wide and widely tracked, so no pair of letters can open a gap
 * the others do not have. Readers get the name from the heading's label.
 */
export function HeroName() {
  const fade = useId()
  return (
    <span className="portal-name" aria-hidden="true">
      LOCALI
      <svg className="portal-name-x" viewBox="0 0 833 687">
        <defs>
          <linearGradient
            id={fade}
            gradientUnits="userSpaceOnUse"
            x1="114"
            y1="0"
            x2="-733"
            y2="-919"
          >
            <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path fill={`url(#${fade})`} d={TRAIL_PATH} />
        <path d={X_PATH} />
      </svg>
    </span>
  )
}
