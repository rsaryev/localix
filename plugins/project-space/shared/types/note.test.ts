import { expect, test } from 'bun:test'
import { emptySpace } from '../format/document'
import { parseSpace } from '../format/parse'
import { serializeSpace } from '../format/serialize'
import { applyOps } from '../ops/apply'
import { spaceTypes } from './index'

test('legacy notes migrate without losing their text or colour', () => {
  const read = spaceTypes.read('note', { text: 'Old plan', color: 'purple' }, 1)
  // A note from before text styles reads as it always drew: its size, the default face and place.
  expect(read).toEqual({
    status: 'ok',
    props: {
      text: 'Old plan',
      color: 'purple',
      size: 'md',
      font: 'sans',
      align: 'start',
      valign: 'top',
    },
  })
})

test('a new note fits its text, and its face and place survive a file round trip', () => {
  const { space } = applyOps(
    emptySpace(),
    [
      { op: 'create', id: 'note', type: 'note', x: 0, y: 0, text: '**Ship** it' },
      { op: 'update', id: 'note', props: { font: 'hand', align: 'center', valign: 'middle' } },
    ],
    { registry: spaceTypes },
  )
  const props = parseSpace(serializeSpace(space), spaceTypes).space.elements.note?.props
  expect(props).toMatchObject({ size: 'auto', font: 'hand', align: 'center', valign: 'middle' })
  expect(props?.text).toBe('**Ship** it')
})

test('a chosen font size survives text edits, resizing and a file round trip', () => {
  for (const size of ['auto', 'sm', 'md', 'lg', 'xl']) {
    const { space, results } = applyOps(
      emptySpace(),
      [
        { op: 'create', id: 'note', type: 'note', props: { size }, x: 0, y: 0 },
        { op: 'update', id: 'note', props: { text: 'A long note\n'.repeat(50) } },
        { op: 'update', id: 'note', w: 80, h: 60 },
      ],
      { registry: spaceTypes },
    )
    expect(results.every((result) => result.ok)).toBe(true)
    const parsed = parseSpace(serializeSpace(space), spaceTypes)
    expect(parsed.issues).toEqual([])
    expect(parsed.space.elements.note?.props.size).toBe(size)
    expect(parsed.space.elements.note?.props.text).toBe('A long note\n'.repeat(50))
    expect(parsed.space.typeVersions.note).toBe(2)
  }
})
