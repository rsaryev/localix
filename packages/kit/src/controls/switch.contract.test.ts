import { describe, test } from 'bun:test'
import { RAW_SWITCH_ROLE, rawOwnerFiles } from '../testing/control-contracts'
import { expectNoRawOwners } from '../testing/ownership-contract'

/**
 * The kit half of the rule: inside the kit only the switch primitive carries `role="switch"`. The
 * same rule over the app and the plugins is a host contract and lives in
 * `apps/ui/src/shared/ui/controls.contract.test.ts`, because the kit never reads the host.
 */
const KIT_ROOT = new URL('../../', import.meta.url).pathname

describe('switch ownership boundary', () => {
  test('routes kit switches through the shared native primitive', async () => {
    const offenders = await rawOwnerFiles({
      cwd: KIT_ROOT,
      roots: ['src'],
      pattern: RAW_SWITCH_ROLE,
      skipTests: true,
      owners: new Set(['src/controls/switch.tsx']),
    })

    expectNoRawOwners(offenders, 'role="switch"')
  })
})
