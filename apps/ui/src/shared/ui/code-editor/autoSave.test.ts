import { describe, expect, it } from 'bun:test'
import { shouldAutoSave, type AutoSaveGate } from './autoSave'

const base: AutoSaveGate = {
  enabled: true,
  dirty: true,
  saving: false,
  hasConflict: false,
  hasError: false,
}

describe('shouldAutoSave', () => {
  it('fires when enabled, dirty, and idle', () => {
    expect(shouldAutoSave(base)).toBe(true)
  })

  it('never fires when the preference is off', () => {
    expect(shouldAutoSave({ ...base, enabled: false })).toBe(false)
  })

  it('does not fire a clean buffer', () => {
    expect(shouldAutoSave({ ...base, dirty: false })).toBe(false)
  })

  it('does not re-enter while a save is in flight', () => {
    expect(shouldAutoSave({ ...base, saving: true })).toBe(false)
  })

  it('stops while a conflict banner is up (no 409 loop)', () => {
    expect(shouldAutoSave({ ...base, hasConflict: true })).toBe(false)
  })

  it('stops after a non-conflict save error until it clears', () => {
    expect(shouldAutoSave({ ...base, hasError: true })).toBe(false)
  })
})
