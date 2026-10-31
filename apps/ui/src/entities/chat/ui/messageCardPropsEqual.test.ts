import { describe, expect, test } from 'bun:test'

import { messageCardPropsEqual } from './messageCardPropsEqual'

const message = { id: 'm1' }
const onEdit = () => {}

describe('messageCardPropsEqual', () => {
  // MessageList rebuilds both on every render; equal by value must not re-render the card.
  test('a rebuilt position and wake-source list with the same values are equal', () => {
    const day = new Date('2026-10-04T00:00:00Z')
    const prev = {
      message,
      onEdit,
      position: { isFirstInGroup: true, isLastInGroup: false, dayStart: day },
      segmentWakeSources: [undefined, 'loop'],
    }
    const next = {
      message,
      onEdit,
      position: { isFirstInGroup: true, isLastInGroup: false, dayStart: new Date(day.getTime()) },
      segmentWakeSources: [undefined, 'loop'],
    }
    expect(messageCardPropsEqual(prev, next)).toBe(true)
  })

  // A continuation row's segments are regrouped on every streaming frame: the same messages in a
  // new array must not re-render its card; a segment that changed must.
  test('rebuilt segments holding the same messages are equal; a changed segment is not', () => {
    const first = { id: 'a1' }
    const second = { id: 'a2' }
    const base = { message, onEdit, segments: [first, second] }
    expect(messageCardPropsEqual(base, { ...base, segments: [first, second] })).toBe(true)
    expect(messageCardPropsEqual(base, { ...base, segments: [first, { id: 'a2' }] })).toBe(false)
    expect(messageCardPropsEqual(base, { ...base, segments: [first] })).toBe(false)
    expect(messageCardPropsEqual(base, { ...base, segments: undefined })).toBe(false)
  })

  test('a changed position, wake source or any other prop re-renders', () => {
    const base = {
      message,
      onEdit,
      position: { isFirstInGroup: true, isLastInGroup: false },
      segmentWakeSources: ['loop'],
    }
    expect(
      messageCardPropsEqual(base, {
        ...base,
        position: { isFirstInGroup: true, isLastInGroup: true },
      }),
    ).toBe(false)
    expect(messageCardPropsEqual(base, { ...base, segmentWakeSources: ['hook'] })).toBe(false)
    expect(messageCardPropsEqual(base, { ...base, message: { id: 'm1' } })).toBe(false)
    expect(messageCardPropsEqual(base, { ...base, onEdit: () => {} })).toBe(false)
    expect(messageCardPropsEqual(base, { ...base, position: undefined })).toBe(false)
  })
})
