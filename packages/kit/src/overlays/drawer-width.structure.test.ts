import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { kitTsxSources } from '../testing/jsx-contract'
import {
  BARE_MAX_WIDTH,
  drawerContentClasses,
  drawerWidthOffenders,
} from '../testing/overlay-contracts'

/**
 * The kit half of the rule. The same scan over the app and the mini apps is a host contract and
 * lives in `apps/ui/src/shared/ui/overlays.contract.test.ts`, because the kit never reads the host;
 * both halves run the one detector in `testing/overlay-contracts`, which the control below covers.
 */
describe('drawer width overrides', () => {
  test('DrawerContent still caps itself behind a breakpoint', () => {
    // The whole rule below exists because of this line. If the base cap ever loses its `md:`
    // prefix, an unprefixed override would start winning and the guard would be enforcing a
    // ceremony that no longer buys anything.
    expect(readFileSync(new URL('./drawer.tsx', import.meta.url), 'utf8')).toContain('md:max-w-205')
  })

  test('a wider drawer says so at the same breakpoint the cap uses', async () => {
    // `DrawerContent` caps itself at `md:max-w-205`. Tailwind emits media-query rules after
    // unprefixed ones, so a bare `max-w-*` override LOSES at md and up — silently, with no
    // error and no visual clue except a squashed panel. That is exactly what happened to the
    // agent editor's model picker: the list collapsed to ~300px and every model name rendered
    // as a single letter. An override must therefore carry the `md:` prefix.
    expect(drawerWidthOffenders(await kitTsxSources())).toEqual([])
  })

  test('the detector fires on the shape it is meant to catch', () => {
    // Positive control: the guard reads source, so it has to be shown failing on the exact
    // string it forbids, or a refactor that breaks the regex would read as "all clear".
    const bad = '<DrawerContent material="popover" className="overflow-hidden p-0 max-w-[80rem]">'
    expect(drawerContentClasses(bad)[0]).toContain('max-w-[80rem]')
    expect(BARE_MAX_WIDTH.test(drawerContentClasses(bad)[0]!)).toBe(true)
    expect(drawerWidthOffenders([{ path: 'x.tsx', source: bad }])).toHaveLength(1)

    const good =
      '<DrawerContent material="popover" className="overflow-hidden p-0 md:max-w-[80rem]">'
    expect(BARE_MAX_WIDTH.test(drawerContentClasses(good)[0]!)).toBe(false)
    expect(drawerWidthOffenders([{ path: 'x.tsx', source: good }])).toEqual([])
  })
})
