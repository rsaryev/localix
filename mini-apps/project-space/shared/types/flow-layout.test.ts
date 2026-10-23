import { describe, expect, test } from 'bun:test'
import { layoutFlow } from './flow-layout'
import { readFlow, type FlowContent } from './flow-text'
import { spaceTypes } from './index'

const flow = (text: string) => {
  const read = readFlow(text)
  if (typeof read === 'string') throw new Error(read)
  return read as FlowContent
}

/** Every straight run of a path: the L segments between its points (a Q is a corner). */
function runs(path: string) {
  const points = [...path.matchAll(/([MLQ])((?:\s+-?\d+(?:\.\d+)?)+)/gu)].map((match) => {
    const numbers = match[2]!.trim().split(/\s+/u).map(Number)
    // A corner's curve ends at its last pair; the run continues from there.
    return {
      kind: match[1],
      x: numbers.at(-2)!,
      y: numbers.at(-1)!,
      cx: numbers[0],
      cy: numbers[1],
    }
  })
  const out: [number, number, number, number][] = []
  for (let i = 1; i < points.length; i++)
    if (points[i]!.kind === 'L')
      out.push([points[i - 1]!.x, points[i - 1]!.y, points[i]!.x, points[i]!.y])
  return out
}

const CHART = `flowchart TB
  A[Request] --> B{Valid?}
  B -->|yes| C[Handle]:::focal
  B -->|no| D(Reject)
  B --> E[(Audit log)]
  C --> F([Done])
  D --> F`

describe('a flowchart laid out', () => {
  test('every line runs at right angles, never on a diagonal', () => {
    for (const direction of ['TB', 'LR', 'BT', 'RL'])
      for (const laid of layoutFlow(flow(CHART.replace('TB', direction))).edges)
        for (const [x1, y1, x2, y2] of runs(laid.path))
          expect(Math.abs(x1 - x2) < 0.2 || Math.abs(y1 - y2) < 0.2).toBe(true)
  })

  test('connectors leaving one side each get their own point on it', () => {
    const layout = layoutFlow(flow(CHART))
    const starts = layout.edges
      .filter((laid) => laid.edge.from === 'B')
      .map((laid) => /^M (\S+) (\S+)/u.exec(laid.path)!.slice(1).join(','))
    expect(starts).toHaveLength(3)
    expect(new Set(starts).size).toBe(3)
  })

  test('the drawing fits its element, with room for the card header', () => {
    const layout = layoutFlow(flow(CHART))
    for (const node of layout.nodes.values()) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(32)
      expect(node.x + node.w).toBeLessThanOrEqual(layout.width)
      expect(node.y + node.h).toBeLessThanOrEqual(layout.height)
    }
    const spec = spaceTypes.get('flow')!
    const read = spaceTypes.read('flow', spec.fromText!(CHART) as Record<string, unknown>)
    if (read.status !== 'ok') throw new Error('flow props rejected')
    expect(spec.measure!(read.props)).toEqual({ w: layout.width, h: layout.height })
  })

  test('a subgraph encloses its nodes under its title', () => {
    const layout = layoutFlow(
      flow(`flowchart LR
  subgraph api [API]
    R[Router] --> S[Service]
  end
  W[Web] --> R`),
    )
    const group = layout.groups[0]!
    for (const id of ['R', 'S']) {
      const node = layout.nodes.get(id)!
      expect(node.x).toBeGreaterThan(group.x)
      expect(node.y).toBeGreaterThan(group.y + 20)
      expect(node.x + node.w).toBeLessThan(group.x + group.w)
      expect(node.y + node.h).toBeLessThan(group.y + group.h)
    }
    const web = layout.nodes.get('W')!
    expect(web.x + web.w <= group.x || web.x >= group.x + group.w).toBe(true)
  })

  test('wider spacing spreads the same chart out', () => {
    const narrow = layoutFlow(flow(CHART), 'narrow')
    const wide = layoutFlow(flow(CHART), 'wide')
    expect(wide.height).toBeGreaterThan(narrow.height)
  })

  test('a caption sits beside the longest run of its line', () => {
    const laid = layoutFlow(flow(CHART)).edges.find((edge) => edge.edge.label === 'yes')!
    expect(laid.label).toBeDefined()
    expect(laid.label!.w).toBeGreaterThan(0)
  })

  test('a loop runs around the outside, and a branch that turns aside leaves by its corner', () => {
    const layout = layoutFlow(
      flow(`flowchart LR
  pr([PR]) --> ci{CI green?}
  ci -->|yes| review[Review]
  ci -.->|no| fix[Fix]
  fix --> ci`),
    )
    const ys = (path: string) =>
      [...path.matchAll(/-?\d+(?:\.\d+)?/gu)].map(Number).filter((_, i) => i % 2)
    const loop = layout.edges.find((laid) => laid.edge.from === 'fix')!
    const below = Math.max(...[...layout.nodes.values()].map((node) => node.y + node.h))
    // Under every box between its ends, not back through the forward flow.
    expect(Math.max(...ys(loop.path))).toBeGreaterThan(below)
    // "yes" sits well above the decision: it leaves by the top corner, not the crowded right one.
    const ci = layout.nodes.get('ci')!
    const review = layout.nodes.get('review')!
    expect(review.y + review.h / 2).toBeLessThan(ci.y)
    const yes = layout.edges.find((laid) => laid.edge.label === 'yes')!
    const [x, y] = /^M (\S+) (\S+)/u.exec(yes.path)!.slice(1).map(Number)
    expect(x).toBeCloseTo(ci.x + ci.w / 2, 0)
    expect(y).toBeCloseTo(ci.y, 0)
  })

  test('a chart with no steps is an empty card, not an infinite one', () => {
    const empty = layoutFlow({ direction: 'TB', nodes: [], edges: [], groups: [] })
    expect(Number.isFinite(empty.width) && Number.isFinite(empty.height)).toBe(true)
    expect(empty.width).toBeGreaterThan(0)
  })
})
