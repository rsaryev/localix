import { describe, expect, test } from 'bun:test'

import { runRule } from '../testing/run-rule.ts'

const RULE = 'no-off-scale-radius'
const IN_PRIMITIVES = 'packages/kit/src/feedback/'

describe(RULE, () => {
  test('reports a bare rounded class in a primitive', async () => {
    const findings = await runRule(
      RULE,
      `export function Badge() {
         return <span className="rounded bg-surface-hover px-1 text-2xs" />
       }`,
      { filename: `${IN_PRIMITIVES}badge.tsx` },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('--radius')
  })

  test('reports bare rounded behind a variant prefix', async () => {
    const findings = await runRule(
      RULE,
      `export function Cell() {
         return <div className="p-1 hover:rounded" />
       }`,
      { filename: `${IN_PRIMITIVES}cell.tsx` },
    )
    expect(findings).toHaveLength(1)
  })

  test('allows every on-scale radius', async () => {
    const findings = await runRule(
      RULE,
      `export function Chip() {
         return <span className="rounded-full border rounded-sm rounded-md rounded-lg" />
       }`,
      { filename: `${IN_PRIMITIVES}chip.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('reports in features and plugins too, not only in the primitives layer', async () => {
    // The scale has to hold where the interface is actually written. Enforcing it only in the
    // twenty primitive files would let it drift in the two hundred everybody edits.
    for (const filename of [
      'apps/ui/src/features/demo/Row.tsx',
      'apps/ui/src/shared/ui/status-item.tsx',
      'plugins/acme/ui/Cell.tsx',
      'packages/plugin-sdk/src/ui/widget.tsx',
    ]) {
      const findings = await runRule(RULE, `export const a = <div className="rounded p-0.5" />`, {
        filename,
      })
      expect(findings).toHaveLength(1)
    }
  })

  test('ignores files outside the interface trees', async () => {
    const findings = await runRule(RULE, `export const a = <div className="rounded p-0.5" />`, {
      filename: 'scripts/demo/Row.tsx',
    })
    expect(findings).toEqual([])
  })
})
