import { clamp, cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * Pure geometry for a circular progress ring. Returns the stroke-dasharray
 * circumference plus the dash offset for a given fill fraction (0–1), so the
 * arc can be drawn with a single stroked <circle>. Extracted so the math is
 * unit-testable independent of the DOM.
 */
// Pure geometry intentionally accompanies the visual primitive for unit tests.
// eslint-disable-next-line react-refresh/only-export-components
export function contextRingGeometry(
  fraction: number,
  radius: number,
): {
  circumference: number
  dashOffset: number
} {
  const f = clamp(fraction, 0, 1)
  const circumference = 2 * Math.PI * radius
  return { circumference, dashOffset: circumference * (1 - f) }
}

const VIEWBOX = 24
const CENTER = 12

/**
 * Monochrome circular usage ring. `fraction` is 0–1 of capacity used; the track
 * is a faint `currentColor` circle and the arc a fuller `currentColor` stroke,
 * so it inherits color from context (no colored gauge). `dot` renders a small
 * center mark (e.g. to flag a cache event). Pure presentation — no data logic.
 */
export function ContextRing({
  fraction,
  size = 18,
  radius = 9,
  strokeWidth = 2.4,
  dot = false,
  className,
  ...aria
}: {
  fraction: number
  size?: number
  radius?: number
  strokeWidth?: number
  dot?: boolean
  className?: string
} & React.AriaAttributes) {
  const { circumference, dashOffset } = contextRingGeometry(fraction, radius)
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={cn(className)}
      aria-hidden="true"
      {...aria}
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={radius}
        fill="none"
        opacity="0.18"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={CENTER}
        cy={CENTER}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        style={{ transformOrigin: 'center', transform: 'rotate(-90deg)' }}
      />
      {dot && <circle cx={CENTER} cy={CENTER} r="2.25" fill="currentColor" opacity="0.55" />}
    </svg>
  )
}
