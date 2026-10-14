import { describe, expect, it } from 'bun:test'
import {
  OVERSIZED_PASTE_CHARS,
  classifyChangeSize,
  isEditPredictionEligible,
  type EditPredictionEligibilitySignals,
} from './nextEditPredictionPolicy'

const OK: EditPredictionEligibilitySignals = {
  docEmpty: false,
  readOnly: false,
  composing: false,
  completionOpen: false,
  bulkEdit: false,
  oversizedPaste: false,
  manual: false,
  inBackoff: false,
}

describe('isEditPredictionEligible', () => {
  it('permits an ordinary edit', () => {
    expect(isEditPredictionEligible(OK)).toEqual({ eligible: true })
  })

  it('blocks each hard-stop condition with its reason', () => {
    expect(isEditPredictionEligible({ ...OK, docEmpty: true })).toEqual({
      eligible: false,
      reason: 'empty',
    })
    expect(isEditPredictionEligible({ ...OK, readOnly: true })).toEqual({
      eligible: false,
      reason: 'read-only',
    })
    expect(isEditPredictionEligible({ ...OK, composing: true })).toEqual({
      eligible: false,
      reason: 'composition',
    })
    expect(isEditPredictionEligible({ ...OK, completionOpen: true })).toEqual({
      eligible: false,
      reason: 'completion-open',
    })
    expect(isEditPredictionEligible({ ...OK, inBackoff: true })).toEqual({
      eligible: false,
      reason: 'backoff',
    })
    expect(isEditPredictionEligible({ ...OK, bulkEdit: true })).toEqual({
      eligible: false,
      reason: 'bulk-edit',
    })
    expect(isEditPredictionEligible({ ...OK, oversizedPaste: true })).toEqual({
      eligible: false,
      reason: 'oversized-paste',
    })
  })

  it('a manual trigger waives the paste/bulk guard but not the hard stops', () => {
    expect(isEditPredictionEligible({ ...OK, oversizedPaste: true, manual: true })).toEqual({
      eligible: true,
    })
    expect(isEditPredictionEligible({ ...OK, bulkEdit: true, manual: true })).toEqual({
      eligible: true,
    })
    expect(isEditPredictionEligible({ ...OK, readOnly: true, manual: true })).toEqual({
      eligible: false,
      reason: 'read-only',
    })
  })
})

// The driver used to measure a paste from the whole-line lengths of the pasted range, and
// Monaco fires `onDidPaste` AFTER the content change, so that estimate overwrote the accurate
// one. Five characters into a long line then read as an oversized paste and the prediction was
// suppressed with nothing to show it had been.
describe('classifyChangeSize', () => {
  const change = (text: string) => ({ text })

  it('measures the inserted text, not the lines it landed in', () => {
    // The line this lands in may be 500 characters long; what was inserted is five.
    expect(classifyChangeSize([change('hello')], false)).toEqual({
      oversizedPaste: false,
      bulkEdit: false,
    })
  })

  it('flags a genuinely oversized insertion', () => {
    const big = 'x'.repeat(OVERSIZED_PASTE_CHARS + 1)
    expect(classifyChangeSize([change(big)], false)).toEqual({
      oversizedPaste: true,
      bulkEdit: false,
    })
  })

  it('sums a multi-cursor insertion across all of its changes', () => {
    const each = 'y'.repeat(OVERSIZED_PASTE_CHARS / 2 + 1)
    expect(classifyChangeSize([change(each), change(each)], false).oversizedPaste).toBe(true)
  })

  it('treats twice the threshold as a bulk edit', () => {
    const huge = 'z'.repeat(OVERSIZED_PASTE_CHARS * 2 + 1)
    expect(classifyChangeSize([change(huge)], false)).toEqual({
      oversizedPaste: true,
      bulkEdit: true,
    })
  })

  it('treats a flush as bulk regardless of size', () => {
    // A whole-model replace (reload, format, refactor) reports no inserted text at all.
    expect(classifyChangeSize([], true)).toEqual({ oversizedPaste: false, bulkEdit: true })
  })

  it('does not flag a deletion', () => {
    expect(classifyChangeSize([change('')], false)).toEqual({
      oversizedPaste: false,
      bulkEdit: false,
    })
  })
})
