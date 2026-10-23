import { expect, test } from 'bun:test'
import { emptySpace } from '../../shared/format/document'
import { applyOps } from '../../shared/ops/apply'
import { spaceTypes } from '../../shared/types'
import { boardKeyHandler, type BoardKeyDeps } from './boardKeys'
import { presentationFrames } from './presentation'

const space = applyOps(
  emptySpace(),
  [
    { op: 'create', id: 'second', type: 'frame', x: 900, y: 0, w: 600, h: 400 },
    { op: 'create', id: 'third', type: 'frame', x: 0, y: 700, w: 600, h: 400 },
    { op: 'create', id: 'first', type: 'frame', x: 0, y: 0, w: 600, h: 400 },
    // A frame inside a frame is part of its slide.
    { op: 'create', id: 'inner', type: 'frame', x: 40, y: 40, w: 200, h: 120 },
    { op: 'create', id: 'note', type: 'note', x: 300, y: 100 },
  ],
  { registry: spaceTypes },
).space

test('the slides are the outer frames in reading order', () => {
  expect(presentationFrames(space)).toEqual(['first', 'second', 'third'])
})

test('while presenting, the keys walk the slides and edit nothing', () => {
  const walked: (number | 'stop')[] = []
  const committed: unknown[] = []
  const deps = {
    space,
    selected: new Set(['note']),
    commit: (ops: unknown) => committed.push(ops),
    presentation: {
      active: true,
      index: 1,
      go: (index: number) => walked.push(index),
      stop: () => walked.push('stop'),
    },
  } as unknown as BoardKeyDeps
  const handler = boardKeyHandler(deps)
  const press = (key: string, code = key) =>
    handler({
      key,
      code,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined,
    } as never)
  press('ArrowRight')
  press(' ', 'Space')
  press('ArrowLeft')
  press('Escape')
  expect(walked).toEqual([2, 2, 0, 'stop'])
  // Delete reaches no element while a slide is on screen.
  expect(press('Backspace')).toBe(true)
  expect(committed).toEqual([])
})
