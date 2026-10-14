import { describe, expect, test } from 'bun:test'

import { createGateRefusalTracker } from './gate-refusal-tracker'

describe('the gate refusal breaker', () => {
  test('trips on refusals back to back', () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 3 })
    expect(tracker.recordAutomaticRefusal()).toBeUndefined()
    expect(tracker.recordAutomaticRefusal()).toBeUndefined()
    const trip = tracker.recordAutomaticRefusal()
    expect(trip?.reason).toContain('3 tool calls in a row')
    expect(trip?.refusals).toBe(3)
  })

  test('a call that gets through clears the chain', () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 3 })
    tracker.recordAutomaticRefusal()
    tracker.recordAutomaticRefusal()
    // One allowed call is evidence the run found a way forward, which is exactly what the
    // consecutive rule is measuring the absence of.
    tracker.recordAllowed()
    expect(tracker.recordAutomaticRefusal()).toBeUndefined()
    expect(tracker.tripped()).toBeUndefined()
  })

  test('working AROUND the wall trips the window instead', () => {
    // Refuse, do something harmless, refuse again: the consecutive count never builds, and
    // before the window rule nothing noticed this at all.
    const tracker = createGateRefusalTracker({ consecutiveMax: 3, windowSize: 20, windowMax: 4 })
    for (let i = 0; i < 3; i += 1) {
      expect(tracker.recordAutomaticRefusal()).toBeUndefined()
      tracker.recordAllowed()
    }
    expect(tracker.recordAutomaticRefusal()?.reason).toContain('4 of the last 20')
  })

  test('the window forgets refusals that fell out of it', () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 99, windowSize: 4, windowMax: 2 })
    tracker.recordAutomaticRefusal()
    for (let i = 0; i < 4; i += 1) tracker.recordAllowed()
    // The first refusal is now older than the window, so this is the window's only one.
    expect(tracker.recordAutomaticRefusal()).toBeUndefined()
    expect(tracker.tripped()).toBeUndefined()
  })

  test('a person declining is neither counted nor forgiven', () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 3 })
    tracker.recordAutomaticRefusal()
    tracker.recordAutomaticRefusal()
    // Not counted: a human is steering and can stop the run themselves — ending it for them
    // would take away the tool they were using. Not a reset either: a decline is no evidence
    // the model found a way forward.
    tracker.recordHumanDecline()
    tracker.recordHumanDecline()
    expect(tracker.tripped()).toBeUndefined()
    expect(tracker.recordAutomaticRefusal()?.refusals).toBe(3)
  })

  test('the verdict latches', () => {
    const tracker = createGateRefusalTracker({ consecutiveMax: 2 })
    tracker.recordAutomaticRefusal()
    const trip = tracker.recordAutomaticRefusal()
    expect(trip).toBeDefined()
    // Whatever happens next, the run already established it cannot get where it was going.
    tracker.recordAllowed()
    expect(tracker.tripped()).toEqual(trip!)
    expect(tracker.recordAutomaticRefusal()).toEqual(trip!)
  })
})
