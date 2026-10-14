import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const params = readFileSync(new URL('./ParamsEditor.tsx', import.meta.url), 'utf8')
const environments = readFileSync(new URL('./EnvironmentEditor.tsx', import.meta.url), 'utf8')
const requestTab = readFileSync(new URL('../RequestTab.tsx', import.meta.url), 'utf8')

/** One rule across the client: a name/value GRID spans its pane; only the label-and-control
 *  FORMS (Auth, Settings) keep a reading measure. Params used to cap its two grids, so Query
 *  and Path stopped short of the URL bar while Headers — the same grid — ran full width. */
describe('pair-grid geometry', () => {
  test('Params does not cap its Query and Path grids', () => {
    expect(params).toContain('<PairEditor')
    expect(params).not.toMatch(/className="[^"]*max-w-/u)
  })

  test('every other grid surface is uncapped too', () => {
    for (const [name, source] of [
      ['EnvironmentEditor', environments],
      ['RequestTab', requestTab],
    ] as const) {
      const grid = source.indexOf('<PairEditor')
      expect(grid).toBeGreaterThan(-1)
      // The wrapper immediately above a grid must not narrow it.
      expect(source.slice(Math.max(0, grid - 200), grid), name).not.toMatch(/max-w-/u)
    }
  })
})
