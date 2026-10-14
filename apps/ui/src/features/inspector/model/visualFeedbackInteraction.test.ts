import { describe, expect, test } from 'bun:test'

import {
  initialVisualFeedbackInteractionState,
  visualFeedbackInteractionReducer,
  visualFeedbackSelection,
} from './visualFeedbackInteraction'

const compose = { key: 'compose|#card|10,20', mode: 'compose' as const }

describe('visual feedback interaction state machine', () => {
  test('scroll preserves a draft while a fresh capture of the same element resets it', () => {
    const capture = {
      kind: 'element' as const,
      selector: '#card',
      summary: 'Card',
      classes: '',
      domPath: 'div',
      rect: { x: 10, y: 20, width: 100, height: 40 },
    }
    const selection = visualFeedbackSelection({ capture, rect: capture.rect })
    const state = { selection, note: 'Keep this note' }
    expect(
      visualFeedbackInteractionReducer(state, {
        type: 'selection-changed',
        selection: visualFeedbackSelection({ capture, rect: { x: 10, y: 5 } }),
      }),
    ).toBe(state)
    expect(
      visualFeedbackInteractionReducer(state, {
        type: 'selection-changed',
        selection: visualFeedbackSelection({ capture: { ...capture }, rect: capture.rect }),
      }).note,
    ).toBe('')
  })
  test('a fresh selection resets the previous draft', () => {
    const opened = visualFeedbackInteractionReducer(initialVisualFeedbackInteractionState, {
      type: 'selection-changed',
      selection: compose,
    })
    const typed = visualFeedbackInteractionReducer(opened, {
      type: 'note-changed',
      note: 'Fix spacing',
    })
    expect(typed.note).toBe('Fix spacing')

    const next = visualFeedbackInteractionReducer(typed, {
      type: 'selection-changed',
      selection: { key: 'compose|#other|30,40', mode: 'compose' },
    })
    expect(next.note).toBe('')
  })

  test('quick-add cannot accumulate an invisible note', () => {
    const quick = visualFeedbackInteractionReducer(initialVisualFeedbackInteractionState, {
      type: 'selection-changed',
      selection: { key: 'quick|text|1,2', mode: 'quick-add' },
    })
    expect(visualFeedbackInteractionReducer(quick, { type: 'note-changed', note: 'hidden' })).toBe(
      quick,
    )
  })

  test('same selection and closed idle transitions preserve references', () => {
    const opened = visualFeedbackInteractionReducer(initialVisualFeedbackInteractionState, {
      type: 'selection-changed',
      selection: compose,
    })
    expect(
      visualFeedbackInteractionReducer(opened, {
        type: 'selection-changed',
        selection: { ...compose },
      }),
    ).toBe(opened)
    expect(
      visualFeedbackInteractionReducer(initialVisualFeedbackInteractionState, { type: 'close' }),
    ).toBe(initialVisualFeedbackInteractionState)
  })
})
