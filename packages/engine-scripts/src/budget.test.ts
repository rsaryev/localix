import { describe, expect, test } from 'bun:test'

import { createCallSlots, createRunBudget, ScriptBudgetError } from './budget'
import { MAX_CALL_ARGS_CHARS, MAX_CALLS, MAX_OUTPUT_CHARS } from './limits'

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** The host's own count of what a script sends, independent of anything the VM measured. */
describe('the run budget', () => {
  test('fails output past its characters, whatever the VM claimed', () => {
    const budget = createRunBudget()
    budget.output({ type: 'text', text: 'x'.repeat(MAX_OUTPUT_CHARS - 1) })
    expect(() => budget.output({ type: 'text', text: 'xx' })).toThrow(ScriptBudgetError)
  })

  test('counts the return value as output', () => {
    const budget = createRunBudget()
    expect(() => budget.returnValue('x'.repeat(MAX_OUTPUT_CHARS + 1))).toThrow(/output passed/)
  })

  test('types an image by its bytes and drops one they do not back', () => {
    const budget = createRunBudget()
    expect(budget.output({ type: 'image', data: PNG, mimeType: 'image/jpeg' })).toEqual({
      type: 'image',
      data: PNG,
      mimeType: 'image/png',
    })
    expect(
      budget.output({ type: 'image', data: '<<notbase64>>!!!', mimeType: 'image/png' }),
    ).toEqual({ type: 'text', text: '[image dropped: not valid PNG, JPEG, GIF or WebP data]' })
    expect(budget.output({ type: 'image', data: 'AAAAAAAA', mimeType: 'image/png' })).toMatchObject(
      {
        type: 'text',
      },
    )
  })

  test('fails a call past the count or the argument size', () => {
    const budget = createRunBudget()
    expect(() => budget.call('x'.repeat(MAX_CALL_ARGS_CHARS + 1))).toThrow(/arguments passed/)
    const counted = createRunBudget()
    for (let index = 0; index < MAX_CALLS; index++) counted.call('{}')
    expect(() => counted.call('{}')).toThrow(/more than/)
  })
})

describe('the call slots', () => {
  test('hand a released slot to the next waiting call, and wake all on close', async () => {
    const slots = createCallSlots(1)
    await slots.acquire()
    let second = false
    let third = false
    void slots.acquire().then(() => (second = true))
    void slots.acquire().then(() => (third = true))
    await Promise.resolve()
    expect([second, third]).toEqual([false, false])
    slots.release()
    await Promise.resolve()
    expect([second, third]).toEqual([true, false])
    slots.close()
    await Promise.resolve()
    expect(third).toBe(true)
  })
})
