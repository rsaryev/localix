import type { VfCapture } from '@localixai/visual-feedback/protocol'
import { previewPickMode } from './previewSelection'

export type VisualFeedbackMode = 'idle' | 'quick-add' | 'compose'

export interface VisualFeedbackSelection {
  key: string
  mode: Exclude<VisualFeedbackMode, 'idle'>
}

export interface VisualFeedbackInteractionState {
  selection: VisualFeedbackSelection | null
  note: string
}

export type VisualFeedbackInteractionAction =
  | { type: 'selection-changed'; selection: VisualFeedbackSelection | null }
  | { type: 'note-changed'; note: string }
  | { type: 'close' }

export const initialVisualFeedbackInteractionState: VisualFeedbackInteractionState = {
  selection: null,
  note: '',
}

// Geometry changes while scrolling; only a fresh capture starts a new draft.
// Weak keys do not retain discarded DOM observations for the session lifetime.
const captureKeys = new WeakMap<VfCapture, string>()
let captureSequence = 0

export function visualFeedbackSelection(
  pending: { capture: VfCapture; rect: { x: number; y: number } } | null,
): VisualFeedbackSelection | null {
  if (!pending) return null
  const mode = previewPickMode(pending.capture) === 'quick-add' ? 'quick-add' : 'compose'
  let key = captureKeys.get(pending.capture)
  if (!key) {
    key = `pick-${++captureSequence}`
    captureKeys.set(pending.capture, key)
  }
  return {
    key,
    mode,
  }
}

export function visualFeedbackInteractionReducer(
  state: VisualFeedbackInteractionState,
  action: VisualFeedbackInteractionAction,
): VisualFeedbackInteractionState {
  switch (action.type) {
    case 'selection-changed':
      if (state.selection?.key === action.selection?.key) return state
      return { selection: action.selection, note: '' }
    case 'note-changed':
      if (state.selection?.mode !== 'compose' || state.note === action.note) return state
      return { ...state, note: action.note }
    case 'close':
      return state.selection === null && state.note === ''
        ? state
        : initialVisualFeedbackInteractionState
  }
}
