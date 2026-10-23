import { expect, test } from 'bun:test'
import { emptySpace } from '../format/document'
import { parseSpace } from '../format/parse'
import { serializeSpace } from '../format/serialize'
import { contentFromText } from '../content/text'
import { applyOps } from '../ops/apply'
import { spaceTypes } from './index'
import { readTable, writeTable } from './table'
import { readMindmap, writeMindmap } from './mindmap-text'
import { layoutMindmap } from './mindmap-layout'
import { penElement, penPath } from './pen'

test('table Markdown round trips empty cells, pipes, backslashes, whitespace and multiline data', () => {
  const value = {
    columns: ['Name', 'Details'],
    rows: [
      ['', ''],
      [' lead ', 'a | b\nnext\tline'],
      ['\\n', 'ends\\'],
    ],
  }
  expect(readTable(writeTable(value))).toEqual(value)
  expect(contentFromText(writeTable(value), spaceTypes)).toEqual({ type: 'table', props: value })
  expect(typeof readTable('| A | B |\n| --- | --- |\n| missing |')).toBe('string')
  expect(
    spaceTypes.get('table')!.props.safeParse({ columns: ['A'], rows: [['x', 'y']] }).success,
  ).toBe(false)
})

test('mindmap Mermaid preserves labels and hierarchy; invalid graphs are refused', () => {
  const text =
    'mindmap\n  root((Main idea))\n    A[First branch]\n      A1[Detail]\n    B[Other branch]'
  const read = readMindmap(text)
  expect(typeof read).not.toBe('string')
  if (typeof read === 'string') throw new Error(read)
  expect(readMindmap(writeMindmap(read))).toEqual(read)
  expect(contentFromText(text, spaceTypes)).toEqual({ type: 'mindmap', props: read })
  const spec = spaceTypes.get('mindmap')!
  for (const nodes of [
    [{ id: 'a', text: 'A', parent: 'missing' }],
    [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    [
      { id: 'root', text: 'Root' },
      { id: 'a', text: 'A', parent: 'b' },
      { id: 'b', text: 'B', parent: 'a' },
    ],
    [
      { id: 'a', text: 'A' },
      { id: 'a', text: 'B', parent: 'a' },
    ],
  ])
    expect(spec.props.safeParse({ nodes }).success).toBe(false)
  expect(typeof readMindmap('mindmap\n  a["unterminated]')).toBe('string')
  expect(typeof readMindmap('mindmap\n  a[123]\n  b')).toBe('string')
  const layout = layoutMindmap(read.nodes)
  expect(layout.boxes).toHaveLength(4)
  expect(layout.edges).toHaveLength(3)
  for (const a of layout.boxes)
    for (const b of layout.boxes) {
      if (a.node.id === b.node.id) continue
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(
        true,
      )
    }
})

test('freehand bounds preserve board points and provide padding for a dot or a stroke', () => {
  const points = [
    { x: -120.5, y: 90 },
    { x: 0, y: 30 },
    { x: 32, y: -40 },
  ]
  const stroke = penElement(points)
  expect(
    stroke.props.points.map((point) => ({ x: point.x + stroke.x, y: point.y + stroke.y })),
  ).toEqual(points)
  expect(penPath(stroke.props.points)).toContain(' Q ')
  expect(penElement([{ x: 1, y: 1 }])).toMatchObject({ w: 10, h: 10 })
  expect(
    spaceTypes.get('pen')!.props.safeParse({ points: [{ x: Number.NaN, y: 1 }] }).success,
  ).toBe(false)
})

test('all new elements survive a board file round trip and resizing without losing content', () => {
  const { space, results } = applyOps(
    emptySpace(),
    [
      { op: 'create', id: 't', type: 'table' },
      { op: 'create', id: 'm', type: 'mindmap', text: 'mindmap\n  Idea\n    Branch' },
      {
        op: 'create',
        id: 'p',
        type: 'pen',
        ...penElement([
          { x: 50, y: 20 },
          { x: 100, y: 80 },
        ]),
      },
      { op: 'update', id: 'p', w: 200, h: 300 },
      { op: 'update', id: 'p', props: { color: 'purple' } },
    ],
    { registry: spaceTypes },
  )
  expect(results.every((result) => result.ok)).toBe(true)
  const read = parseSpace(serializeSpace(space), spaceTypes)
  expect(read.issues).toEqual([])
  for (const id of ['t', 'm', 'p']) expect(read.space.elements[id]).toEqual(space.elements[id])
  expect(read.space.elements.p).toMatchObject({ w: 200, h: 300, props: { color: 'purple' } })
})
