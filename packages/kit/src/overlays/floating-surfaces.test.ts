import { describe, expect, test } from 'bun:test'
import { kitTsxSources } from '../testing/jsx-contract'
import { structuredPopoverViolations } from '../testing/overlay-contracts'

describe('workbench floating-surface contracts', () => {
  test('every structured popover keeps pinned regions around one scrolling body', async () => {
    // The kit's own popovers. The product's are the host half of this rule, in
    // `apps/ui/src/shared/ui/overlays.contract.test.ts`, because the kit never reads the host.
    const { checked, violations } = structuredPopoverViolations(await kitTsxSources())
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  test('the structured-popover detector reads both directions (positive control)', () => {
    const scan = (source: string) =>
      structuredPopoverViolations([{ path: 'x.tsx', source }]).violations
    expect(
      scan('<PopoverContent layout="structured"><PopoverHeader /><PopoverBody /></PopoverContent>'),
    ).toEqual([])
    expect(scan('<PopoverContent><PopoverBody /></PopoverContent>')).toEqual([
      'x.tsx:1 must opt into structured layout when it uses a structured region',
    ])
    expect(scan('<PopoverContent layout="structured"><PopoverFooter /></PopoverContent>')).toEqual([
      'x.tsx:1 must declare the one scrolling PopoverBody',
    ])
  })
})
