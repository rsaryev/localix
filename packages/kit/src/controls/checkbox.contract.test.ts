import { describe, test } from 'bun:test'
import { RAW_CHECKBOX, rawOwnerFiles } from '../testing/control-contracts'
import { expectNoRawOwners } from '../testing/ownership-contract'

/**
 * The kit half of the rule: inside the kit only the two native primitives own a raw checkbox
 * input. The same rule over the app and the mini apps is a host contract and lives in
 * `apps/ui/src/shared/ui/controls.contract.test.ts`, because the kit never reads the host.
 */
const KIT_ROOT = new URL('../../', import.meta.url).pathname

describe('checkbox ownership boundary', () => {
  test('routes kit checkboxes through the shared native primitive', async () => {
    const offenders = await rawOwnerFiles({
      cwd: KIT_ROOT,
      roots: ['src'],
      pattern: RAW_CHECKBOX,
      skipTests: false,
      owners: new Set(['src/controls/checkbox.tsx', 'src/controls/switch.tsx']),
    })

    expectNoRawOwners(offenders, 'input type="checkbox"')
  })
})
