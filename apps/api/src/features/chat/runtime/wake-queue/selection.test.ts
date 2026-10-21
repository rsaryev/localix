import { describe, expect, test } from 'bun:test'

import { bandRecipient, selectDrainBand } from './selection'
import { event, ids, person, report } from './test-entries'

describe('selectDrainBand', () => {
  test('an empty queue, or one where everything is held, selects nothing', () => {
    expect(selectDrainBand([])).toEqual([])
    const held = [report('a', 'agent:lead')]
    expect(selectDrainBand(held, { held: new Set(['a']) })).toEqual([])
  })

  test('send-now takes its exact row ahead of the normal head; a missing one falls back', () => {
    const listed = [person('first'), event('selected')]
    expect(ids(selectDrainBand(listed, { preferredItemId: 'selected' }))).toEqual(['selected'])
    expect(ids(selectDrainBand(listed, { preferredItemId: 'missing' }))).toEqual(['first'])
  })

  test('plain machine wakes are delivered one at a time, in order', () => {
    const listed = [event('a'), event('b'), event('c')]
    expect(ids(selectDrainBand(listed))).toEqual(['a'])
  })

  test('the reports to one delegator gather across other wakes, and only theirs', () => {
    const listed = [
      report('a', 'agent:lead'),
      event('loop'),
      report('other', 'agent:qa'),
      report('b', 'agent:lead'),
    ]
    expect(ids(selectDrainBand(listed))).toEqual(['a', 'b'])
  })

  test('a held report waits while what is behind it goes ahead', () => {
    const listed = [report('a', 'agent:lead'), event('loop')]
    expect(ids(selectDrainBand(listed, { held: new Set(['a']) }))).toEqual(['loop'])
  })

  test("the person's lines typed in a row are one turn — until another address or an attachment", () => {
    const image = [{ kind: 'image', id: 'img' }] as never
    expect(ids(selectDrainBand([person('a'), person('b'), person('c', '@qa look')]))).toEqual([
      'a',
      'b',
    ])
    expect(ids(selectDrainBand([person('a'), person('b', 'b', { bindings: image })]))).toEqual([
      'a',
    ])
    expect(ids(selectDrainBand([person('a', '@qa x'), person('b', 'and @qa y')]))).toEqual([
      'a',
      'b',
    ])
  })

  test('a hidden prompt and a webhook are never merged with what the person typed', () => {
    const hidden = person('hidden', 'wizard', { internal: true, person: true, source: 'external' })
    expect(ids(selectDrainBand([person('a'), hidden]))).toEqual(['a'])
    expect(ids(selectDrainBand([hidden, person('a')]))).toEqual(['hidden'])
  })

  test('the wakes of one stream gather; another addressee or stream stays apart', () => {
    const listed = [
      event('a', { coalesce: 'mon:1' }),
      event('b', { coalesce: 'mon:2' }),
      event('c', { coalesce: 'mon:1', to: { participant: 'agent:qa' } }),
      event('d', { coalesce: 'mon:1' }),
    ]
    expect(ids(selectDrainBand(listed))).toEqual(['a', 'd'])
  })

  test('a band ends where the priority changes', () => {
    const later = { ...report('b', 'agent:lead'), priority: 11 }
    expect(ids(selectDrainBand([report('a', 'agent:lead'), later]))).toEqual(['a'])
  })

  test('a band claimed once replays with exactly its entries, not a newcomer of its key', () => {
    const a = report('a', 'agent:lead')
    const b = report('b', 'agent:lead')
    const late = report('late', 'agent:lead')
    const claimed = [a, b].map((item) => ({ ...item, value: { ...item.value, batch: 'a' } }))
    expect(ids(selectDrainBand([...claimed, late]))).toEqual(['a', 'b'])
    expect(ids(selectDrainBand([late, ...claimed]))).toEqual(['late'])
  })

  test('send-now on a line of a claimed batch takes the whole batch, never the line alone', () => {
    const claimed = [person('a'), person('b')].map((item) => ({
      ...item,
      value: { ...item.value, batch: 'a' },
    }))
    expect(ids(selectDrainBand([event('x'), ...claimed], { preferredItemId: 'b' }))).toEqual([
      'a',
      'b',
    ])
  })

  test('a failed entry is skipped: what is behind it is delivered', () => {
    const failed = { ...person('a'), value: { ...person('a').value, failure: 'boom' } }
    expect(ids(selectDrainBand([failed, person('b')]))).toEqual(['b'])
  })
})

describe('bandRecipient', () => {
  test('a band is addressed only when its entries agree', () => {
    const lead = { participant: 'agent:lead' }
    expect(bandRecipient([{ to: lead }, { to: lead }])).toEqual(lead)
    expect(bandRecipient([{ to: lead }, { to: { participant: 'agent:qa' } }])).toBeUndefined()
    expect(bandRecipient([{}, {}])).toBeUndefined()
  })
})
