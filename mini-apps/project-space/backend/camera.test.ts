import { describe, expect, test } from 'bun:test'
import { emptySpace } from '../shared/format/document'
import { applyOps } from '../shared/ops/apply'
import { visibleRect } from '../shared/camera'
import { cameraMove, elementsIn } from '../shared/camera-target'
import { spaceTypes } from '../shared/types'
import { cameraHub } from './camera-hub'

const space = applyOps(
  emptySpace(),
  [
    { op: 'create', type: 'note', id: 'a', x: 0, y: 0, w: 100, h: 100 },
    { op: 'create', type: 'note', id: 'b', x: 400, y: 200, w: 100, h: 100 },
    { op: 'create', type: 'note', id: 'far', x: 5000, y: 5000, w: 100, h: 100 },
    { op: 'group', ids: ['a', 'b'], id: 'pair' },
  ],
  { registry: spaceTypes },
).space

describe('what the agent asks the camera for', () => {
  test('focus frames the named elements together, a group standing for its members', () => {
    expect(cameraMove(space, { focus: ['pair'] })).toEqual({
      kind: 'frame',
      rect: { x: 0, y: 0, w: 500, h: 300 },
      subject: 'many',
      spotlight: ['a', 'b'],
    })
    // One element is ONE subject: the tab brings it to a reading size, not the region fit.
    expect(cameraMove(space, { focus: ['a'], zoom: 1.5 })).toMatchObject({
      zoom: 1.5,
      subject: 'one',
      spotlight: ['a'],
    })
  })

  test('fit frames the whole board; an empty board and an unknown id are refused by name', () => {
    expect(cameraMove(space, { fit: true })).toMatchObject({ rect: { x: 0, y: 0, w: 5100 } })
    expect(cameraMove(emptySpace(), { fit: true })).toContain('empty')
    expect(cameraMove(space, { focus: ['ghost'] })).toContain('"ghost"')
  })

  test('pan and zoom alone are moves of their own; asking for nothing says what to ask', () => {
    expect(cameraMove(space, { pan: { x: 0.5 } })).toEqual({ kind: 'pan', x: 0.5, y: 0 })
    expect(cameraMove(space, { zoom: 2 })).toEqual({ kind: 'zoom', zoom: 2 })
    expect(cameraMove(space, {})).toContain('say where to look')
  })

  test('the view a report describes lists what is in it and not what is far off', () => {
    const rect = visibleRect({
      viewport: { x: 100, y: 50, zoom: 0.5 },
      size: { width: 1200, height: 800 },
    })
    expect(rect).toEqual({ x: -200, y: -100, w: 2400, h: 1600 })
    expect(elementsIn(space, rect)).toEqual(['a', 'b'])
  })
})

describe('the camera hub', () => {
  test('a following tab gets the move at once, and the tool gets that move’s report', async () => {
    const moves: unknown[] = []
    const off = cameraHub.follow('S-hub-1', (command) => moves.push(command))
    expect(cameraHub.listening('S-hub-1')).toBe(true)
    const seq = cameraHub.send('S-hub-1', { kind: 'zoom', zoom: 1 })
    expect(moves).toEqual([{ seq, move: { kind: 'zoom', zoom: 1 } }])
    const answer = cameraHub.awaitReport('S-hub-1', seq, 1_000)
    cameraHub.report('S-hub-1', {
      seq,
      viewport: { x: 0, y: 0, zoom: 1 },
      size: { width: 10, height: 10 },
    })
    expect(await answer).toMatchObject({ seq })
    off()
    expect(cameraHub.listening('S-hub-1')).toBe(false)
    cameraHub.send('S-hub-1', { kind: 'zoom', zoom: 2 })
    expect(moves).toHaveLength(1)
  })

  test('a tab that starts following just after the move still gets it', () => {
    const seq = cameraHub.send('S-hub-2', { kind: 'pan', x: 1, y: 0 })
    const moves: unknown[] = []
    const off = cameraHub.follow('S-hub-2', (command) => moves.push(command))
    expect(moves).toEqual([{ seq, move: { kind: 'pan', x: 1, y: 0 } }])
    off()
  })

  test('no report in time is null, so the tool can say the tab did not answer', async () => {
    expect(await cameraHub.awaitReport('S-hub-3', 1, 20)).toBeNull()
  })
})
