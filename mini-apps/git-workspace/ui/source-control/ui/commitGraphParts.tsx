import { GitBranch, Tag } from 'lucide-react'
import type { RepoRef } from '../../../backend/source-control/contracts'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { CommitLaneRow } from '../model/commitLanes'

/** Pixel width per rail lane. The node dot sits at the lane's horizontal centre. */
const LANE_W = 12
/**
 * Vertical centre of the commit node, in px from the row's top: the middle of the
 * subject line (a 1.75px row inset plus half an 18px `text-xs` line).
 *
 * In px, not in a stretched viewBox: the rail used to be `viewBox="0 0 W 100"` with
 * `preserveAspectRatio="none"` over a ~37px row, which scaled y by ~0.37 but x by 1 —
 * every node and the base ring rendered as a flat ellipse. With no viewBox, SVG user
 * units are px, circles stay circles, and edges reach the row's far edge as `100%`.
 */
export const COMMIT_NODE_Y_PX = 11

/**
 * The graph rail column for ONE commit row — an SVG of the lanes
 * and edges passing through this row, with the commit's node dot at its lane.
 * Monochrome by design: lanes are drawn in the border token at reduced opacity
 * (weight/opacity distinguish them, never colour); the node reuses the accent dot.
 * `isBase` draws the compare-mark ring around the node, mirroring the old dot.
 */
export function CommitRail({
  row,
  laneCount,
  isBase,
}: {
  row: CommitLaneRow
  laneCount: number
  isBase: boolean
}) {
  const width = Math.max(1, laneCount) * LANE_W
  const cx = (lane: number) => lane * LANE_W + LANE_W / 2
  return (
    <span className="relative shrink-0 self-stretch" style={{ width }} aria-hidden>
      <svg className="absolute inset-0 h-full w-full overflow-visible text-border">
        {row.edges.map((e, k) => {
          const topX = cx(e.top)
          const botX = cx(e.bottom)
          const [y1, y2] =
            e.kind === 'to'
              ? [0, COMMIT_NODE_Y_PX]
              : e.kind === 'from'
                ? [COMMIT_NODE_Y_PX, '100%']
                : [0, '100%']
          return (
            <line
              key={k}
              x1={topX}
              y1={y1}
              x2={botX}
              y2={y2}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeOpacity={e.kind === 'through' ? 0.55 : 0.85}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {isBase && (
          <circle
            cx={cx(row.lane)}
            cy={COMMIT_NODE_Y_PX}
            r={5}
            fill="none"
            className="text-control-border-focus"
            stroke="currentColor"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <circle
          cx={cx(row.lane)}
          cy={COMMIT_NODE_Y_PX}
          r={row.merge ? 3.2 : 2.6}
          // `text-faint` as a real colour, not `text-accent`: under glass `accent` is a 6%
          // foreground VEIL, and a 2.6px-radius node filled with a 6% veil is invisible.
          className="fill-current text-text-faint"
          stroke="var(--background)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  )
}

/** How many ref chips to render inline before collapsing the rest into "+N". */
const MAX_REF_CHIPS = 3

/**
 * Ref decorations on a commit row (branch heads / remotes / tags / detached HEAD),
 * rendered as badges. The current branch is highlighted,
 * other local branches are subtle, remotes are dimmed, tags carry a distinct
 * glyph, and long names truncate with a title tooltip. Beyond `MAX_REF_CHIPS` the
 * overflow collapses into a `+N` chip whose title lists every hidden ref.
 */
export function RefChips({ refs }: { refs: RepoRef[] }) {
  if (refs.length === 0) return null
  const shown = refs.slice(0, MAX_REF_CHIPS)
  const overflow = refs.slice(MAX_REF_CHIPS)
  return (
    <>
      {/* NOTE: the param is deliberately NOT ref-like-named — RepoRef has a
          `current` field, and `<anythingRef>.current` reads as a React ref to
          the react-hooks/refs lint. */}
      {shown.map((chip) => {
        const label = chip.kind === 'head' ? 'HEAD' : chip.name
        const Icon = chip.kind === 'tag' ? Tag : GitBranch
        return (
          <span
            key={`${chip.kind}:${chip.name}`}
            title={
              chip.kind === 'remote'
                ? `remote: ${chip.name}`
                : chip.kind === 'tag'
                  ? `tag: ${chip.name}`
                  : label
            }
            className={cn(
              'flex min-w-0 shrink-0 items-center gap-0.5 rounded-sm px-1 text-2xs font-medium',
              chip.current
                ? // 11% veil, not `bg-accent/20`: `accent` is itself a 6% veil under glass, so
                  // `/20` of it was a 1.2% fill — the CURRENT branch chip read fainter than its
                  // plain siblings' 4.2%. The focus ring stays; only the fill was inverted.
                  'bg-surface-active text-foreground ring-1 ring-control-border-focus/60'
                : chip.kind === 'remote'
                  ? 'bg-surface-hover/60 text-text-faint'
                  : 'bg-surface-hover/60 text-text-soft',
            )}
          >
            <Icon className="size-2.5 shrink-0" />
            <span className="max-w-24 truncate">{label}</span>
          </span>
        )
      })}
      {overflow.length > 0 && (
        // `rounded-sm` like its sibling chips; a pill among squares read as a different control.
        <span
          title={overflow.map((r) => (r.kind === 'head' ? 'HEAD' : r.name)).join(', ')}
          className="shrink-0 rounded-sm bg-surface-hover/60 px-1 text-2xs font-medium text-text-faint"
        >
          +{overflow.length}
        </span>
      )}
    </>
  )
}
