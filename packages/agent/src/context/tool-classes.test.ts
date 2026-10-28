import { describe, expect, test } from 'bun:test'
import {
  ALL_MUTATE_TOOLS,
  MUTATE_TOOLS,
  NONIDEMPOTENT_TOOLS,
  PAGED_READ_RESULT_TOOLS,
  PATCH_TOOLS,
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
    const baseReads = ['grep', 'list', 'ls', 'lsp', 'Read', 'Search']
    expect([...PAGED_READ_RESULT_TOOLS].sort()).toEqual(baseReads.sort())
    for (const name of baseReads) expect(READ_RESULT_TOOLS.has(name)).toBe(true)
    expect([...MUTATE_TOOLS].sort()).toEqual(['Edit', 'Write'].sort())
    expect([...PATCH_TOOLS].sort()).toEqual(['apply_patch', 'patch'].sort())
    expect([...NONIDEMPOTENT_TOOLS].sort()).toEqual(['Bash', 'shell', 'terminal'].sort())
  })

  test('the removed lsp_diagnostics tool is in no class', () => {
    for (const set of [
      READ_RESULT_TOOLS,
      MUTATE_TOOLS,
      PATCH_TOOLS,
      ALL_MUTATE_TOOLS,
      NONIDEMPOTENT_TOOLS,
    ]) {
      expect(set.has('lsp_diagnostics')).toBe(false)
    }
  })

  test('ALL_MUTATE_TOOLS is exactly the union of single-arg writers and patch appliers', () => {
    const union = new Set([...MUTATE_TOOLS, ...PATCH_TOOLS])
    expect([...ALL_MUTATE_TOOLS].sort()).toEqual([...union].sort())
    for (const t of [...MUTATE_TOOLS, ...PATCH_TOOLS]) expect(ALL_MUTATE_TOOLS.has(t)).toBe(true)
  })

  test('read, mutate, and non-idempotent classes are mutually disjoint', () => {
    const read = [...READ_RESULT_TOOLS]
    for (const t of read) {
      expect(ALL_MUTATE_TOOLS.has(t)).toBe(false)
      expect(NONIDEMPOTENT_TOOLS.has(t)).toBe(false)
    }
    for (const t of ALL_MUTATE_TOOLS) expect(NONIDEMPOTENT_TOOLS.has(t)).toBe(false)
  })

  test('bash/terminal are non-idempotent and never recoverable (cannot be re-run safely)', () => {
    expect(NONIDEMPOTENT_TOOLS.has('Bash')).toBe(true)
    expect(READ_RESULT_TOOLS.has('Bash')).toBe(false)
    expect(ALL_MUTATE_TOOLS.has('Bash')).toBe(false)
  })

  test('patch tools live in PATCH_TOOLS, not the single-arg MUTATE_TOOLS', () => {
    expect(PATCH_TOOLS.has('apply_patch')).toBe(true)
    expect(PATCH_TOOLS.has('patch')).toBe(true)
    expect(MUTATE_TOOLS.has('apply_patch')).toBe(false)
  })

  test('registerContextToolClasses extends the exported sets in place and is idempotent', () => {
    registerContextToolClasses({
      readResult: ['x_read'],
      mutate: ['x_write'],
      patch: ['x_patch'],
      nonidempotent: ['x_run'],
    })
    registerContextToolClasses({ readResult: ['x_read'] })

    expect(READ_RESULT_TOOLS.has('x_read')).toBe(true)
    expect(PAGED_READ_RESULT_TOOLS.has('x_read')).toBe(false)
    expect(MUTATE_TOOLS.has('x_write')).toBe(true)
    expect(ALL_MUTATE_TOOLS.has('x_write')).toBe(true)
    expect(PATCH_TOOLS.has('x_patch')).toBe(true)
    expect(ALL_MUTATE_TOOLS.has('x_patch')).toBe(true)
    expect(NONIDEMPOTENT_TOOLS.has('x_run')).toBe(true)
    expect([...READ_RESULT_TOOLS].filter((t) => t === 'x_read')).toHaveLength(1)
  })
})
