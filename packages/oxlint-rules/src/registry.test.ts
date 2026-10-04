import { readdir } from 'node:fs/promises'
import { describe, expect, test } from 'bun:test'

import { RULES } from './index.ts'

/**
 * A rule file nobody registered is a rule that silently never runs, and that failure looks exactly
 * like "the code is clean". This test is what makes that impossible.
 */
describe('rule registry', () => {
  test('registers every rule file, and no rule that has no file', async () => {
    const entries = await readdir(new URL('rules/', import.meta.url))
    const onDisk = entries
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => name.replace(/\.ts$/u, ''))
      .sort()

    expect(Object.keys(RULES).sort()).toEqual(onDisk)
  })

  test('every registered rule can be created', () => {
    for (const [name, rule] of Object.entries(RULES)) {
      const visitor = rule.create({ filename: `/tmp/${name}.tsx`, report: () => {} })
      expect(typeof visitor).toBe('object')
    }
  })
})
