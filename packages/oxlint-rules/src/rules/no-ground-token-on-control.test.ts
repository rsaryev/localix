import { describe, expect, test } from 'bun:test'

import { runRule } from '../testing/run-rule.ts'

const RULE = 'no-ground-token-on-control'
const IN_PRIMITIVES = 'packages/kit/src/controls/'
const IN_HOST_COMPOSITES = 'apps/ui/src/shared/ui/'
const IN_SDK = 'packages/mini-app-sdk/src/ui/'

describe(RULE, () => {
  test('reports a raised ground painted on a chip', async () => {
    const findings = await runRule(
      RULE,
      `export function Chip() {
         return <span className="rounded-full bg-surface-raised px-2 text-2xs" />
       }`,
      { filename: `${IN_PRIMITIVES}chip.tsx` },
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('veil')
  })

  test('reports a ground painted on a token-sized control', async () => {
    const findings = await runRule(
      RULE,
      `export function Trigger() {
         return <button className="h-[var(--chrome-control-md)] bg-background" />
       }`,
      { filename: `${IN_PRIMITIVES}trigger.tsx` },
    )
    expect(findings).toHaveLength(1)
  })

  test('reports the sunken black veil on a control', async () => {
    const findings = await runRule(
      RULE,
      `export function Field() {
         return <input className="h-8 rounded-md bg-surface-sunken px-2" />
       }`,
      { filename: `${IN_SDK}field.tsx` },
    )
    expect(findings).toHaveLength(1)
  })

  test('still reports in the host composites the kit move left behind', async () => {
    const findings = await runRule(
      RULE,
      `export function StatusItem() {
         return <button className="h-6 rounded-full bg-surface-raised px-2" />
       }`,
      { filename: `${IN_HOST_COMPOSITES}status-item.tsx` },
    )
    expect(findings).toHaveLength(1)
  })

  test('allows the frosted floating-surface recipe', async () => {
    const findings = await runRule(
      RULE,
      `export function Pill() {
         return <span className="rounded-full bg-surface-raised/90 px-2 backdrop-blur" />
       }`,
      { filename: `${IN_PRIMITIVES}action-pill.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('allows the veils and the opaque companion', async () => {
    const findings = await runRule(
      RULE,
      `export function Field() {
         return (
           <div className="h-8 rounded-md bg-input/20 px-2">
             <span className="size-4 rounded-full bg-background-solid" />
             <span className="rounded-full px-2 bg-foreground/[0.04]" />
           </div>
         )
       }`,
      { filename: `${IN_PRIMITIVES}field.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('allows a pane painting its own ground', async () => {
    const findings = await runRule(
      RULE,
      `export function Pane() {
         return <div className="flex h-full flex-col bg-background" />
       }`,
      { filename: `${IN_PRIMITIVES}pane.tsx` },
    )
    expect(findings).toEqual([])
  })

  test('ignores files outside the primitives layer', async () => {
    const findings = await runRule(
      RULE,
      `export function Row() {
         return <span className="rounded-full bg-surface-raised px-2" />
       }`,
      { filename: 'apps/ui/src/features/demo/Row.tsx' },
    )
    expect(findings).toEqual([])
  })
})
