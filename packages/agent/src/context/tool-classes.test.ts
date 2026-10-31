import { describe, expect, test } from 'bun:test'
import {
  MUTATE_TOOLS,
  NONIDEMPOTENT_TOOLS,
  PAGED_READ_RESULT_TOOLS,
  READ_RESULT_TOOLS,
  registerContextToolClasses,
} from './tool-classes'

describe('VBC tool-class vocabulary (single source of truth)', () => {
  // Exact-membership snapshots: relationship tests (union/disjointness) can't catch a
  // tool being silently added to or dropped from a class. Pin the immutable PAGED subset
  // for reads because READ_RESULT_TOOLS is intentionally extended process-wide by app/plugin
  // bootstrap (and another test file may register one first). Other base sets are generic.
  // Note: `lsp_diagnostics` is NOT a read-result tool — the standalone tool was removed
  // (diagnostics now ride inline on edit results), so it must not reappear here.
  test('each base class has exactly its expected generic members', () => {
    const baseReads = ['Read', 'Search']
    expect([...PAGED_READ_RESULT_TOOLS].sort()).toEqual(baseReads.sort())
    for (const name of baseReads) expect(READ_RESULT_TOOLS.has(name)).toBe(true)
    expect([...MUTATE_TOOLS].sort()).toEqual(['Edit', 'Write'].sort())
    expect([...NONIDEMPOTENT_TOOLS].sort()).toEqual(['Bash'].sort())
  })

  test('the removed lsp_diagnostics tool is in no class', () => {
    for (const set of [READ_RESULT_TOOLS, MUTATE_TOOLS, NONIDEMPOTENT_TOOLS]) {
      expect(set.has('lsp_diagnostics')).toBe(false)
    }
  })

  test('read, mutate, and non-idempotent classes are mutually disjoint', () => {
    const read = [...READ_RESULT_TOOLS]
    for (const t of read) {
      expect(MUTATE_TOOLS.has(t)).toBe(false)
      expect(NONIDEMPOTENT_TOOLS.has(t)).toBe(false)
    }
    for (const t of MUTATE_TOOLS) expect(NONIDEMPOTENT_TOOLS.has(t)).toBe(false)
  })

  test('Bash is non-idempotent and never recoverable (cannot be re-run safely)', () => {
    expect(NONIDEMPOTENT_TOOLS.has('Bash')).toBe(true)
    expect(READ_RESULT_TOOLS.has('Bash')).toBe(false)
    expect(MUTATE_TOOLS.has('Bash')).toBe(false)
  })

  test('the retired patch tool names are in no class', () => {
    for (const name of ['apply_patch', 'patch']) {
      for (const set of [READ_RESULT_TOOLS, MUTATE_TOOLS, NONIDEMPOTENT_TOOLS]) {
        expect(set.has(name)).toBe(false)
      }
    }
  })

  test('registerContextToolClasses extends the exported sets in place and is idempotent', () => {
    registerContextToolClasses({
      readResult: ['x_read'],
      mutate: ['x_write'],
      nonidempotent: ['x_run'],
    })
    registerContextToolClasses({ readResult: ['x_read'] })

    expect(READ_RESULT_TOOLS.has('x_read')).toBe(true)
    expect(PAGED_READ_RESULT_TOOLS.has('x_read')).toBe(false)
    expect(MUTATE_TOOLS.has('x_write')).toBe(true)
    expect(NONIDEMPOTENT_TOOLS.has('x_run')).toBe(true)
    expect([...READ_RESULT_TOOLS].filter((t) => t === 'x_read')).toHaveLength(1)
  })
})
