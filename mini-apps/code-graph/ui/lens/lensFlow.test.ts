import { describe, expect, test } from 'bun:test'
import type { CodeCard, Lens } from '../../shared/lens'
import type { NodeSummaryView } from '../../shared/view'
import { cardSize, IN_HANDLE, lineHandle, lineY } from './geometry'
import { CARD_TYPE, lensFlow } from './lensFlow'

const fn = (id: string, extra: Partial<NodeSummaryView> = {}): NodeSummaryView => ({
  id,
  kind: 'function',
  name: id.split('#')[1] ?? id,
  path: id.slice(4, id.indexOf('#')),
  parent: `file:${id.slice(4, id.indexOf('#'))}`,
  line: 1,
  endLine: 3,
  dependents: 0,
  dependencies: 0,
  size: 0,
  ...extra,
})

function card(
  node: NodeSummaryView,
  calls: Array<[number, NodeSummaryView]>,
  startLine = 10,
): CodeCard {
  return {
    node,
    language: 'typescript',
    startLine,
    lines: ['function x() {', '  a()', '  b()', '}'],
    truncated: false,
    stale: false,
    outline: [{ id: node.id, name: node.name, kind: node.kind }],
    links: calls.map(([line, target]) => ({
      kind: 'call' as const,
      line,
      column: 2,
      endColumn: 3,
      target,
    })),
    callees: [...new Map(calls.map(([, target]) => [target.id, target])).values()],
  }
}

const apply = fn('sym:a.ts#applyFix')
const normalize = fn('sym:b.ts#normalize')
const save = fn('sym:c.ts#save')
const onInput = fn('sym:d.ts#onInput')

const handlers = {
  onFollow: () => {},
  onPrepend: () => {},
  onOpenFile: () => {},
  onReveal: () => {},
}

describe('lensFlow', () => {
  const lens: Lens = {
    trail: [
      card(apply, [
        [11, normalize],
        [12, save],
      ]),
      card(normalize, [], 1),
    ],
    callers: [onInput],
  }
  const flow = lensFlow(lens, handlers)

  test('callers, then the trail left to right, then what the last card calls', () => {
    const x = (id: string) => flow.nodes.find((node) => node.id === id)?.position.x ?? Number.NaN
    expect(x(onInput.id)).toBeLessThan(x(apply.id))
    expect(x(apply.id)).toBeLessThan(x(normalize.id))
    expect(flow.nodes.filter((node) => node.type === CARD_TYPE).map((node) => node.id)).toEqual([
      apply.id,
      normalize.id,
    ])
    // `save` is called by applyFix, not by the last card, so it is not drawn as a callee tile.
    expect(flow.nodes.some((node) => node.id === save.id)).toBe(false)
  })

  test('the edge between cards leaves from the line holding the call it followed', () => {
    const between = flow.edges.find(
      (edge) => edge.source === apply.id && edge.target === normalize.id,
    )
    expect(between?.sourceHandle).toBe(lineHandle(11))
    expect(between?.targetHandle).toBe(IN_HANDLE)
    expect(between?.data?.emphasis).toBe('focus')
    expect(flow.edges.find((edge) => edge.source === onInput.id)?.targetHandle).toBe(IN_HANDLE)
  })

  test('callee tiles of the last card sit opposite their call line, never overlapping', () => {
    const last = card(
      normalize,
      [
        [2, apply],
        [2, save],
      ],
      1,
    )
    const tiles = lensFlow({ trail: [last], callers: [] }, handlers).nodes.filter(
      (node) => node.type !== CARD_TYPE,
    )
    const [first, second] = tiles
    expect(first?.position.y).toBe(lineY(last, 2) - 18)
    expect((second?.position.y ?? 0) >= (first?.position.y ?? 0) + 36).toBe(true)
  })

  test('the camera settles on the last card', () => {
    expect(flow.focus?.width).toBe(cardSize(lens.trail[1] as CodeCard).width)
  })
})
