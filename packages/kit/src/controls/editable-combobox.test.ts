import { describe, expect, test } from 'bun:test'
import { editableComboboxViolations } from '../testing/control-contracts'
import { kitTsxSources } from '../testing/jsx-contract'

/**
 * The kit half of the rule. The same rule over the app and the mini apps is a host contract and
 * lives in `apps/ui/src/shared/ui/controls.contract.test.ts`, because the kit never reads the host.
 */
describe('editable combobox architecture', () => {
  test('keeps the combobox role on the focus-owning editor with a complete list contract', async () => {
    expect(editableComboboxViolations(await kitTsxSources())).toEqual([])
  })
})
