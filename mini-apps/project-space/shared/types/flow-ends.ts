import type { FlowBox } from './flow-nodes'
import type { Point, Side } from './flow-route'
import type { FlowContent } from './flow-text'

/**
 * Which sides a flowchart's connector leaves and enters by, and where a loop runs. Read with
 * `flow-layout.ts`, which places the boxes these ends belong to.
 */
export const vertical = (direction: FlowContent['direction']) =>
  direction === 'TB' || direction === 'BT'

const FORWARD: Record<FlowContent['direction'], Point> = {
  TB: { x: 0, y: 1 },
  BT: { x: 0, y: -1 },
  LR: { x: 1, y: 0 },
  RL: { x: -1, y: 0 },
}
const FACING: Record<FlowContent['direction'], [Side, Side]> = {
  TB: ['bottom', 'top'],
  BT: ['top', 'bottom'],
  LR: ['right', 'left'],
  RL: ['left', 'right'],
}

export interface Ends {
  sides: [Side, Side]
  /** Runs against the flow: drawn around the outside instead of back through it. */
  loop: boolean
}

/**
 * The sides an edge leaves and enters by. Along the flow, a box's leading side to the next one's
 * trailing side; a decision's branch that turns aside leaves by the corner on its side (yes runs
 * on, no drops below), as a flowchart is drawn by hand; within one rank, the sides that face each
 * other; and against the flow, both by the outer side, so a loop goes around rather than through.
 */
export function endsOf(
  from: FlowBox,
  to: FlowBox,
  direction: FlowContent['direction'],
  decision: boolean,
): Ends {
  const down = vertical(direction)
  const forward = FORWARD[direction]
  const dx = to.x + to.w / 2 - (from.x + from.w / 2)
  const dy = to.y + to.h / 2 - (from.y + from.h / 2)
  const along = dx * forward.x + dy * forward.y
  const reach = (down ? Math.min(from.h, to.h) : Math.min(from.w, to.w)) / 2
  if (along < -reach) return { sides: down ? ['right', 'right'] : ['bottom', 'bottom'], loop: true }
  if (Math.abs(along) < reach) {
    const sides: [Side, Side] = down
      ? dx > 0
        ? ['right', 'left']
        : ['left', 'right']
      : dy > 0
        ? ['bottom', 'top']
        : ['top', 'bottom']
    return { sides, loop: false }
  }
  const [leading, trailing] = FACING[direction]
  const aside = down ? Math.abs(dx) > from.w / 2 : Math.abs(dy) > from.h / 2
  if (decision && aside)
    return {
      sides: [down ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top', trailing],
      loop: false,
    }
  return { sides: [leading, trailing], loop: false }
}

/**
 * A loop's lane: just outside everything between its ends, on the outer side, each further loop a
 * step further out so two loops never share a line.
 */
export function loopRoute(
  start: Point,
  end: Point,
  boxes: Iterable<FlowBox>,
  down: boolean,
  step: number,
) {
  const clearance = 20 + step * 12
  if (down) {
    const [top, bottom] = [Math.min(start.y, end.y), Math.max(start.y, end.y)]
    let lane = Math.max(start.x, end.x)
    for (const box of boxes)
      if (box.y < bottom && box.y + box.h > top) lane = Math.max(lane, box.x + box.w)
    lane += clearance
    return [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end]
  }
  const [left, right] = [Math.min(start.x, end.x), Math.max(start.x, end.x)]
  let lane = Math.max(start.y, end.y)
  for (const box of boxes)
    if (box.x < right && box.x + box.w > left) lane = Math.max(lane, box.y + box.h)
  lane += clearance
  return [start, { x: start.x, y: lane }, { x: end.x, y: lane }, end]
}
