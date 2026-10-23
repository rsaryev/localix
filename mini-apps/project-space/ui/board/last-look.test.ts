import { afterEach, expect, test } from 'bun:test'
import { forgetLooks, rememberLook } from './lastLook'
import { placementOf } from './placement'

afterEach(forgetLooks)

test('the next element of a kind takes the look last given to one, and only its style', () => {
  expect(placementOf('note')?.props.color).toBe('yellow')
  rememberLook('note', { color: 'green', font: 'hand', text: 'never remembered' })
  const note = placementOf('note')?.props
  expect(note).toMatchObject({ color: 'green', font: 'hand', text: '' })
  // A shape is its own habit; a value set to null returns the note to its default.
  expect(placementOf('shape')?.props.color).toBe('blue')
  rememberLook('note', { color: null })
  expect(placementOf('note')?.props.color).toBe('yellow')
  // What the tool asks for still wins over the habit.
  rememberLook('shape', { color: 'red' })
  expect(placementOf('shape', { color: 'purple' })?.props.color).toBe('purple')
})

test('a new connector takes the line style last chosen, never its label', async () => {
  const { lastLine, rememberLine } = await import('./lastLook')
  expect(lastLine()).toEqual({})
  rememberLine({ route: 'elbow', weight: 'bold', label: 'not a style' })
  rememberLine({ color: 'green' })
  expect(lastLine()).toEqual({ route: 'elbow', weight: 'bold', color: 'green' })
  rememberLine({ weight: null })
  expect(lastLine()).toEqual({ route: 'elbow', color: 'green' })
})
