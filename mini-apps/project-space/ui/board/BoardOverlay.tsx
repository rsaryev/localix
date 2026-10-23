import { useCanvasZoom, ViewportPortal } from '@localixai/kit/canvas'
import type { SpaceDocument } from '../../shared/format/document'
import { groupsOf } from '../../shared/ops/groups'
import type { Box } from '../../shared/ops/geometry'
import { boundsOfBoxes } from '../../shared/ops/layout'
import { selectedGroups } from './selection'
import type { Guide } from './snap'
import type { ElementNode } from './toFlow'

/**
 * What the board draws over its elements, in board coordinates: the smart guides of a snapping
 * drag, a dashed outline around each selected group (a group has no body of its own, so without
 * it a selected group reads as a loose multi-selection), and a fainter one around the group the
 * person has entered. Strokes are divided by the zoom, one screen pixel at every camera.
 */
const PAD = 6

interface OverlayProps {
  guides: readonly Guide[]
  outlines: readonly (Box & { entered: boolean })[]
}

/** Nothing to draw subscribes to nothing: an empty overlay must not re-render on every camera frame. */
export function BoardOverlay(props: OverlayProps) {
  if (props.guides.length === 0 && props.outlines.length === 0) return null
  return <Drawn {...props} />
}

function Drawn({ guides, outlines }: OverlayProps) {
  const zoom = useCanvasZoom()
  const stroke = 1 / zoom
  return (
    <ViewportPortal>
      <svg className="space-overlay" width={1} height={1} aria-hidden>
        {outlines.map((box, index) => (
          <rect
            key={`outline-${index}`}
            className="space-group-outline"
            data-entered={box.entered || undefined}
            x={box.x - PAD / zoom}
            y={box.y - PAD / zoom}
            width={box.w + (PAD * 2) / zoom}
            height={box.h + (PAD * 2) / zoom}
            rx={4 / zoom}
            strokeWidth={stroke}
            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          />
        ))}
        {guides.map((guide, index) => (
          <line
            key={`guide-${index}`}
            className="space-guide"
            strokeWidth={stroke}
            {...(guide.axis === 'x'
              ? { x1: guide.at, x2: guide.at, y1: guide.from, y2: guide.to }
              : { x1: guide.from, x2: guide.to, y1: guide.at, y2: guide.at })}
          />
        ))}
      </svg>
    </ViewportPortal>
  )
}

/** The boxes to outline: every wholly selected group, and the entered one, where they are now. */
export function groupOutlines(
  space: SpaceDocument,
  nodes: readonly ElementNode[],
  selected: ReadonlySet<string>,
  entered: string | null,
): (Box & { entered: boolean })[] {
  const at = new Map(nodes.map((node) => [node.id, node]))
  const boxOf = (members: readonly string[]) =>
    boundsOfBoxes(
      members.flatMap((id) => {
        const node = at.get(id)
        return node
          ? [{ x: node.position.x, y: node.position.y, w: node.width ?? 0, h: node.height ?? 0 }]
          : []
      }),
    )
  const outlines = [...selectedGroups(space, selected, entered).values()].map((members) => ({
    ...boxOf(members),
    entered: false,
  }))
  const inside = entered ? groupsOf(space).get(entered) : undefined
  if (inside) outlines.push({ ...boxOf(inside), entered: true })
  return outlines
}
