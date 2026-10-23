import { describe, expect, test } from 'bun:test'
import {
  editableComboboxViolations,
  RAW_CHECKBOX,
  RAW_RADIO,
  RAW_SELECT,
  RAW_SWITCH_ROLE,
  rawOwnerFiles,
  untypedNativeButtons,
} from '@localixai/kit/testing/control-contracts'
import { tsxSourcesUnder } from '@localixai/kit/testing/jsx-contract'
import { expectNoRawOwners } from '@localixai/kit/testing/ownership-contract'

/**
 * The product-wide halves of the kit's control contracts.
 *
 * A primitive the product routes around no longer owns its behavior: a raw `<select>` brings its
 * own keyboard model, a hand-written `role="switch"` its own announcement. The kit proves its own
 * sources keep each rule (`packages/kit/src/controls/*.contract.test.ts`), but the kit never reads
 * the host, so the same detectors run over the app and the mini apps here. Every primitive that
 * owns a raw control lives in the kit now, so no host file is exempt.
 */
const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname
const HOST_ROOTS = ['apps/ui/src', 'mini-apps'] as const

const hostSources = () => tsxSourcesUnder(REPO_ROOT, HOST_ROOTS)
const hostRawOwners = (pattern: RegExp, skipTests: boolean) =>
  rawOwnerFiles({ cwd: REPO_ROOT, roots: HOST_ROOTS, pattern, skipTests })

describe('button semantics boundary', () => {
  test('requires every native product button to declare its form behavior', async () => {
    expect(untypedNativeButtons(await hostSources())).toEqual([])
  })
})

describe('checkbox ownership boundary', () => {
  test('routes product checkboxes through the shared native primitive', async () => {
    expectNoRawOwners(await hostRawOwners(RAW_CHECKBOX, false), 'input type="checkbox"')
  })
})

describe('radio ownership boundary', () => {
  test('routes product radio choices through shared keyboard-owning primitives', async () => {
    expectNoRawOwners(await hostRawOwners(RAW_RADIO, true), 'radio')
  })
})

describe('select ownership boundary', () => {
  test('routes closed product choices through the shared keyboard-owning Select', async () => {
    expectNoRawOwners(await hostRawOwners(RAW_SELECT, true), 'select')
  })
})

describe('switch ownership boundary', () => {
  test('routes product switches through the shared native primitive', async () => {
    expectNoRawOwners(await hostRawOwners(RAW_SWITCH_ROLE, true), 'role="switch"')
  })
})

describe('editable combobox architecture', () => {
  test('keeps the combobox role on the focus-owning editor with a complete list contract', async () => {
    expect(editableComboboxViolations(await hostSources())).toEqual([])
  })
})
