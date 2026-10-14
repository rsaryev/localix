import { describe, expect, it } from 'bun:test'
import { nextEnterAction } from './hitlKeys'

describe('nextEnterAction', () => {
  it('submits on the last question when everything is answered', () => {
    expect(nextEnterAction({ currentAnswered: true, canSubmit: true, isLast: true })).toBe('submit')
  })

  it('does not submit on the last question while some answer is missing', () => {
    expect(nextEnterAction({ currentAnswered: true, canSubmit: false, isLast: true })).toBeNull()
  })

  it('advances to the next question when the current one is answered', () => {
    expect(nextEnterAction({ currentAnswered: true, canSubmit: false, isLast: false })).toBe('next')
  })

  it('does nothing when the current question is unanswered', () => {
    expect(nextEnterAction({ currentAnswered: false, canSubmit: false, isLast: false })).toBeNull()
  })

  it('never advances past an answered non-last question even if the whole form is complete', () => {
    // canSubmit can be true mid-sequence when later questions carry defaults;
    // Enter should still step through rather than skip to submit.
    expect(nextEnterAction({ currentAnswered: true, canSubmit: true, isLast: false })).toBe('next')
  })
})
