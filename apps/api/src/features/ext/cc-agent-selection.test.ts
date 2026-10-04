/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { roleNameOfSubagentType } from './cc-agent-selection'
import { scanSources } from '../../lib/source-lint'

/** The CC selector rule has one adapter owner; native handoffs do not interpret it. */
const SRC_ROOT = path.resolve(import.meta.dir, '..', '..')

describe('the general-purpose rule', () => {
  test('blank, whitespace and any casing of general-purpose mean NO named role', () => {
    for (const input of [
      undefined,
      '',
      '   ',
      'general-purpose',
      'General-Purpose',
      'GENERAL-PURPOSE',
    ]) {
      expect(
        roleNameOfSubagentType(input),
        `${JSON.stringify(input)} must resolve to no role`,
      ).toBe(undefined)
    }
  })

  test('a real role name survives, trimmed', () => {
    expect(roleNameOfSubagentType('  sample:reviewer  ')).toBe('sample:reviewer')
    expect(roleNameOfSubagentType('verifier')).toBe('verifier')
    // Not a prefix/substring match: an agent whose name merely CONTAINS the alias is a real role.
    expect(roleNameOfSubagentType('general-purpose-plus')).toBe('general-purpose-plus')
  })

  test('the constant is declared exactly once in the codebase', async () => {
    const files = await scanSources({
      root: SRC_ROOT,
      include: ['**/*.ts'],
      skip: (file) => file.includes('.test.'),
      minFiles: 100,
    })
    const declarations = files.filter((f) => /export const GENERAL_PURPOSE_AGENT\s*=/u.test(f.code))
    expect(
      declarations.map((f) => f.file),
      'the alias must have ONE owner — a second declaration is a copy that can drift',
    ).toEqual(['features/ext/cc-agent-selection.ts'])
  })

  test('no file re-implements the rule with its own casing comparison', async () => {
    // The inline third copy: `roleName.toLowerCase() !== GENERAL_PURPOSE_AGENT`. Callers must ask
    // `roleNameOfSubagentType`, or the alias set is only as complete as the least-updated call site.
    const files = await scanSources({
      root: SRC_ROOT,
      include: ['**/*.ts'],
      skip: (file) => file.includes('.test.') || file === 'features/ext/cc-agent-selection.ts',
      minFiles: 100,
    })
    const offenders = files
      .filter((f) => /toLowerCase\(\)\s*[!=]==\s*GENERAL_PURPOSE_AGENT/u.test(f.code))
      .map((f) => f.file)
    expect(
      offenders,
      'these compare against the alias themselves instead of asking the owner',
    ).toEqual([])
  })
})
