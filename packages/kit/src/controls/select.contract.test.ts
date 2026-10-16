import { describe, test } from 'bun:test'
import { RAW_SELECT, rawOwnerFiles } from '../testing/control-contracts'
import { expectNoRawOwners } from '../testing/ownership-contract'

/**
 * The kit half of the rule. The same rule over the app and the plugins is a host contract and
 * lives in `apps/ui/src/shared/ui/controls.contract.test.ts`, because the kit never reads the host.
 */
const KIT_ROOT = new URL('../../', import.meta.url).pathname

describe('select ownership boundary', () => {
  test('routes closed kit choices through the shared keyboard-owning Select', async () => {
    const offenders = await rawOwnerFiles({
      cwd: KIT_ROOT,
      roots: ['src'],
      pattern: RAW_SELECT,
      skipTests: true,
    })

    expectNoRawOwners(offenders, 'select')
  })
})
