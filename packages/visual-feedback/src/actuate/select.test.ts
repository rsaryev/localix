/**
 * The `select` step: choose an option of a native dropdown by its value or its visible label.
 * A page reacts to `input` + `change` (React, Vue, a plain listener), so both must fire, and
 * choosing what is already chosen fires nothing, as in a browser.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { buildSnapshot, createRefRegistry } from '../snapshot/index'
import { installConsoleCapture, runCommand, type ActuateDeps } from './index'

beforeAll(() => GlobalRegistrator.register())
afterAll(() => GlobalRegistrator.unregister())

const deps = (): ActuateDeps => ({
  reg: createRefRegistry(),
  console: installConsoleCapture(),
  prevTree: { value: '' },
  settle: async () => {},
})

const FORM = `
  <select id="c" aria-label="Country">
    <option value="fr">France</option>
    <option value="us" selected>United States</option>
    <option value="de" disabled>Germany</option>
    <option value="">Other</option>
  </select>
  <input id="t" aria-label="Name">`

let events: string[]
beforeEach(() => {
  document.body.innerHTML = FORM
  events = []
  const select = document.querySelector('#c') as HTMLSelectElement
  for (const type of ['input', 'change']) select.addEventListener(type, () => events.push(type))
})

const select = (step: Record<string, unknown>, d = deps()) => {
  const ref = /\[ref=(e\d+)\]/.exec(buildSnapshot(d.reg).tree)![1]
  return runCommand({ action: 'steps', steps: [{ action: 'select', ref, ...step }] } as never, d)
}
const value = () => (document.querySelector('#c') as HTMLSelectElement).value

describe('select step', () => {
  test('picks an option by value and tells the page with input then change', async () => {
    const r = await select({ text: 'fr' })
    expect(r.ok).toBe(true)
    expect(value()).toBe('fr')
    expect(events).toEqual(['input', 'change'])
    expect(r.result?.note).toContain('selected "France"')
  })

  test('picks an option by its visible label, ignoring case', async () => {
    const r = await select({ text: 'france' })
    expect(r.ok).toBe(true)
    expect(value()).toBe('fr')
  })

  test('a value wins over a label that spells the same', async () => {
    document.body.innerHTML =
      '<select aria-label="S"><option value="b">a</option><option value="a">b</option></select>'
    const r = await select({ text: 'a' })
    expect(r.ok).toBe(true)
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('a')
  })

  test('the empty value can be chosen by its label', async () => {
    const r = await select({ text: 'Other' })
    expect(r.ok).toBe(true)
    expect(value()).toBe('')
  })

  test('the option already chosen reports unchanged and fires nothing', async () => {
    const r = await select({ text: 'us' })
    expect(r.ok).toBe(true)
    expect(r.result?.note).toContain('already')
    expect(events).toEqual([])
  })

  test('an unknown option lists what is on offer', async () => {
    const r = await select({ text: 'Spain' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no such option: Spain')
    expect(r.error).toContain('France')
    expect(r.error).toContain('United States')
    expect(r.error).not.toContain('Germany')
    expect(value()).toBe('us')
  })

  test('a disabled option cannot be picked', async () => {
    const r = await select({ text: 'de' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('no such option: de')
  })

  test('a multiple dropdown adds the option and keeps the others chosen', async () => {
    document.body.innerHTML = `<select id="c" multiple aria-label="Tags">
      <option value="a" selected>Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select>`
    const sel = document.querySelector('#c') as HTMLSelectElement
    const r = await select({ text: 'Gamma' })
    expect(r.ok).toBe(true)
    expect(Array.from(sel.selectedOptions).map((o) => o.value)).toEqual(['a', 'c'])
    // Alpha is chosen already, though it is not the first-listed selectedIndex of the pick.
    const again = await select({ text: 'Alpha' })
    expect(again.result?.note).toContain('already')
  })

  test('a disabled dropdown cannot be picked from', async () => {
    ;(document.querySelector('#c') as HTMLSelectElement).disabled = true
    const r = await select({ text: 'fr' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('disabled')
    expect(value()).toBe('us')
    expect(events).toEqual([])
  })

  test('a field that is not a dropdown is named as such', async () => {
    const d = deps()
    const tree = buildSnapshot(d.reg).tree
    const ref = new RegExp('"Name".*\\[ref=(e\\d+)\\]').exec(tree)![1]
    const r = await runCommand(
      { action: 'steps', steps: [{ action: 'select', ref, text: 'x' }] } as never,
      d,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not a dropdown')
  })

  test('needs the option to choose', async () => {
    const r = await select({})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('`select` requires `text`')
  })

  test('works through a CSS selector and a single call, not only in a batch', async () => {
    const r = await runCommand({ action: 'select', selector: '#c', text: 'fr' } as never, deps())
    expect(r.ok).toBe(true)
    expect(value()).toBe('fr')
  })
})
