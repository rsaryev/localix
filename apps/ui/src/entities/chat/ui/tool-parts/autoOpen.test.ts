import { describe, expect, it } from 'bun:test'

import { autoOpenTransition } from './autoOpen'

// Regression: command / interactive-terminal cards mounted while streaming used
// `defaultOpen`, which only seeds useState — so they stayed EXPANDED forever
// after the run finished, unlike every other tool card. The follow-mode signal
// must open on the rising edge and settle the card closed on the falling edge,
// while a manual user toggle always wins.
describe('autoOpenTransition', () => {
  it('opens on the rising edge (command starts streaming)', () => {
    expect(autoOpenTransition(false, true, false)).toBe(true)
  })

  it('settles closed on the falling edge (command finished)', () => {
    expect(autoOpenTransition(true, false, false)).toBe(false)
  })

  it('no edge → leaves the state alone (no churn while streaming or when idle)', () => {
    expect(autoOpenTransition(true, true, false)).toBeNull()
    expect(autoOpenTransition(false, false, false)).toBeNull()
  })

  it('no signal (card does not use follow-mode) → never interferes', () => {
    expect(autoOpenTransition(undefined, undefined, false)).toBeNull()
    expect(autoOpenTransition(true, undefined, false)).toBeNull()
  })

  it('a manual user toggle wins over later signal edges', () => {
    // User collapsed a streaming card → the finish edge must not reopen/close it.
    expect(autoOpenTransition(true, false, true)).toBeNull()
    // User expanded a finished card → a re-run signal must not fight them.
    expect(autoOpenTransition(false, true, true)).toBeNull()
  })

  // The card sweep moved every dynamic `defaultOpen` onto follow-mode. Two
  // signal shapes ride the same transition:
  describe('sweep signal shapes', () => {
    it('error-after-mount (GenericToolCard / AskToolPart: `hasError`) — rising edge opens a card that mounted closed', () => {
      // mounted while running (signal false) … then the tool fails
      expect(autoOpenTransition(false, true, false)).toBe(true)
      // error signal never falls → the card stays open, no further churn
      expect(autoOpenTransition(true, true, false)).toBeNull()
    })

    it('settle-OPEN deliverables (QuizToolPart) — signal rises on completion and never falls; only the user closes it', () => {
      // mounted mid-stream (deliverable not ready) → opens when the deliverable lands
      expect(autoOpenTransition(false, true, false)).toBe(true)
      // stays open across re-renders …
      expect(autoOpenTransition(true, true, false)).toBeNull()
      // … and after a manual close, the constant-true signal must not reopen it
      expect(autoOpenTransition(true, true, true)).toBeNull()
    })
  })
})
