import { describe, expect, test } from 'bun:test'
import {
  vaultDraftReady,
  vaultKeyProblem,
  vaultMissingFields,
  vaultValueProblem,
} from './vaultDraftErrors'

const draft = (over: Partial<{ key: string; value: string; title: string }> = {}) => ({
  key: '',
  value: '',
  title: '',
  ...over,
})

describe('what each mode requires', () => {
  test('create needs an alias and a value; edit needs a title; rotate needs a value', () => {
    expect(vaultDraftReady('create', draft({ key: 'K', value: 'v' }))).toBe(true)
    expect(vaultDraftReady('create', draft({ key: 'K' }))).toBe(false)
    expect(vaultDraftReady('edit', draft({ title: 'Prod db' }))).toBe(true)
    expect(vaultDraftReady('edit', draft())).toBe(false)
    expect(vaultDraftReady('rotate', draft({ value: 'v' }))).toBe(true)
  })

  test('readiness is asked of the values, never of a stale message', () => {
    // The dialog re-renders with last click's "Required." still on screen; if that decided
    // whether this click may proceed, a corrected form would stay stuck.
    expect(vaultDraftReady('create', draft({ key: 'K', value: 'v' }))).toBe(true)
  })
})

describe('what a submit reports as missing', () => {
  /**
   * The live checks in `secretDraft` deliberately say nothing about an EMPTY field —
   * untouched is not wrong, just not ready — which is right while typing and useless at the
   * moment of the click. The dialog used to carry that difference by grey ing the submit out,
   * naming no field at all.
   */
  test('names the empty required fields, in the order they appear', () => {
    expect(Object.keys(vaultMissingFields('create', draft()))).toEqual(['key', 'value'])
    expect(Object.keys(vaultMissingFields('edit', draft()))).toEqual(['title'])
    expect(Object.keys(vaultMissingFields('rotate', draft()))).toEqual(['value'])
  })

  test('a filled field is not reported', () => {
    expect(vaultMissingFields('create', draft({ key: 'K', value: 'v' }))).toEqual({})
  })
})

describe('which message a field shows', () => {
  test('a malformed value outranks "Required." — it is the more specific answer', () => {
    const missing = { key: 'Required.' }
    expect(vaultKeyProblem('create', 'not a key!', missing)).toContain('Key:')
  })

  test('the submit message shows when the field is merely empty', () => {
    expect(vaultKeyProblem('create', '', { key: 'Required.' })).toBe('Required.')
    expect(vaultValueProblem('rotate', '', { value: 'Required.' })).toBe('Required.')
  })

  test('a mode that does not own the field reports nothing about it', () => {
    // The alias is fixed after creation; the value is not edited in metadata mode.
    expect(vaultKeyProblem('edit', 'not a key!', {})).toBeUndefined()
    expect(vaultValueProblem('edit', 'x'.repeat(1_000_000), {})).toBeUndefined()
  })
})
