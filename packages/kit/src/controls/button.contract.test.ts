import { describe, expect, test } from 'bun:test'
import { untypedNativeButtons } from '../testing/control-contracts'
import { kitTsxSources } from '../testing/jsx-contract'

/**
 * The kit half of the rule. The same rule over the app and the plugins is a host contract and
 * lives in `apps/ui/src/shared/ui/controls.contract.test.ts`, because the kit never reads the host.
 */
describe('button semantics boundary', () => {
  test('requires every native kit button to declare its form behavior', async () => {
    expect(untypedNativeButtons(await kitTsxSources())).toEqual([])
  })

  test('the detector fires on an untyped native button only (positive control)', () => {
    const source = [
      'export const A = () => <button onClick={go}>Go</button>',
      'export const B = () => <button type="button">Go</button>',
      'export const C = () => <Button>Go</Button>',
    ].join('\n')
    expect(untypedNativeButtons([{ path: 'x.tsx', source }])).toEqual([{ path: 'x.tsx', line: 1 }])
  })
})
