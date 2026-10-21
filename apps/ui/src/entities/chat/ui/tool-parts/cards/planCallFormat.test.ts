import { describe, expect, test } from 'bun:test'

import { planCallShape, planCallSubtitle } from './planCallFormat'

const stored = { id: 'plan-3', version: 3, title: 'Cache layer' }

describe('what one plan call did', () => {
  test('a call without an action is a presentation, named by its stored version', () => {
    const shape = planCallShape({
      input: { title: 'Cache layer', body: '…' },
      output: { plan: stored },
    })
    expect(shape.action).toBe('present')
    expect(shape.plan).toEqual({ id: 'plan-3', version: 3 })
    expect(planCallSubtitle(shape)).toBe('Presented plan v3')
  })

  test('a read is named as a read, never as a presentation', () => {
    const shape = planCallShape({ input: { action: 'read', version: 2 }, output: undefined })
    expect(shape.action).toBe('read')
    expect(planCallSubtitle(shape)).toBe('Read plan v2')
  })

  test('a completion carries its summary and the version it completed', () => {
    const shape = planCallShape({
      input: { action: 'complete', summary: '  Cache shipped behind a flag.  ' },
      output: { plan: stored },
    })
    expect(shape.action).toBe('complete')
    expect(shape.summary).toBe('Cache shipped behind a flag.')
    expect(shape.title).toBe('Cache layer')
    expect(planCallSubtitle(shape)).toBe('Completed plan v3')
  })

  test('without a version anywhere the subtitle still says what happened', () => {
    const shape = planCallShape({ input: { action: 'complete' }, output: undefined })
    expect(shape.plan).toBeNull()
    expect(shape.summary).toBeUndefined()
    expect(planCallSubtitle(shape)).toBe('Completed plan')
  })

  test('an unknown action is read as a presentation rather than dropped', () => {
    expect(planCallShape({ input: { action: 'rewrite' }, output: undefined }).action).toBe(
      'present',
    )
  })
})
