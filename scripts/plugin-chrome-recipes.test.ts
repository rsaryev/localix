import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { STATUS_ITEM_PLACEMENTS } from '@localixai/plugin-sdk/ui'

const REPO_ROOT = resolve(import.meta.dir, '..')
const PLUGINS_ROOT = join(REPO_ROOT, 'mini-apps')
/** The titlebar action recipe, through the kit's door or the host path it moved out of. */
const CHROME_ACTION_IMPORT = /['"](?:@localixai\/kit|@\/shared\/ui)\/chrome-action['"]/u

function pluginUiSources(): { path: string; source: string }[] {
  return readdirSync(PLUGINS_ROOT, { encoding: 'utf8', recursive: true })
    .filter(
      (entry) =>
        /\.tsx?$/u.test(entry) &&
        entry.includes('/ui/') &&
        !/(?:^|\/)(?:node_modules|dist)\//u.test(entry) &&
        !/\.(?:dom\.)?test\.tsx?$/u.test(entry),
    )
    .map((entry) => ({
      path: `mini-apps/${entry}`,
      source: readFileSync(join(PLUGINS_ROOT, entry), 'utf8'),
    }))
}

/**
 * Persistent chrome is the HOST's to draw.
 *
 * Lives under `scripts/` rather than in `apps/ui`: it reads the plugin tree, and core may hold
 * plugin UI to a contract but may not name a concrete plugin.
 *
 * The rule exists because the seam it replaces was a free React surface. `chrome-action.ts` says
 * in its own docblock that host and plugin actions must keep the same hit target and that a
 * chrome action "should never invent its own focus, hover, pressed" — and the one contributed
 * button in the titlebar had its own hardcoded height, no focus ring and no press feedback, sitting
 * between two host buttons that had all three. Nothing warned. The contract is declarative now
 * (`host.statusItems.register`), and this is what keeps the old door shut.
 */
describe('plugins do not draw the workbench chrome', () => {
  const sources = pluginUiSources()

  test('the plugin UI tree is actually being read', () => {
    // A scan that reaches nothing is a disabled lint: an empty offender list looks exactly like a
    // clean tree.
    expect(sources.length).toBeGreaterThan(50)
  })

  test('no plugin reaches for the titlebar action recipe', () => {
    // `chrome-action` is the TITLEBAR's control, and a plugin has no titlebar of its own — every
    // use of it is a plugin drawing the app's chrome. `workbench-statusbar` is deliberately NOT
    // on this list: a plugin panel may have its own status row (the roster footer, the SQL result
    // footer), and that is the primitive for it. The rule is about whose bar it is, not about
    // which import looks like chrome.
    //
    // The recipe now lives in the kit, whose `@localixai/kit/chrome-action` door is the same
    // specifier a plugin imports every other primitive through — so the door is matched as well
    // as the old host path, or the move would have reopened exactly what this test shuts.
    const offenders = sources
      .filter(({ source }) => CHROME_ACTION_IMPORT.test(source))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
    expect(CHROME_ACTION_IMPORT.test(`from '@localixai/kit/chrome-action'`)).toBe(true)
    expect(CHROME_ACTION_IMPORT.test(`from '@/shared/ui/chrome-action'`)).toBe(true)
    expect(CHROME_ACTION_IMPORT.test(`from '@localixai/kit/workbench-statusbar'`)).toBe(false)
  })

  test('no plugin fills the titlebar through a free surface', () => {
    // `breadcrumb.trailing` was that surface, and it is gone. A plugin naming it again would
    // render nowhere, which is a worse failure than a compile error: silence looks like a broken
    // plugin.
    //
    // `composer.context` deliberately survives, for a control whose affordance is an inline PANEL
    // rather than a menu — a paragraph explaining a predicted merge conflict has no menu row to
    // live in. What that costs is a rule, not a licence: the surviving surface still renders the
    // host's `ComposerChip`, asserted in the plugin's own structure test.
    const offenders = sources
      .filter(({ source }) => source.includes("'breadcrumb.trailing'"))
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  test('a contributed status item is DECLARED, never a component', () => {
    // The one field that would undo the whole standard. A plugin that could hand over JSX would,
    // and in six months the bar is four differently-sized buttons again.
    const offenders = sources
      .filter(({ source }) =>
        // Scoped to ONE call's own object literal — `[^)]` stops the match before the next
        // `register(`, so a neighbouring seam that legitimately takes a component is not blamed.
        /statusItems\.register\(\s*\{[^)]*?\bComponent\s*:/u.test(source),
      )
      .map(({ path }) => path)
    expect(offenders).toEqual([])
  })

  test('every contributed placement is one the host actually renders', () => {
    // An unknown placement renders NOTHING, quietly — which is the right runtime behaviour (a
    // plugin built against a newer SDK must not throw on an older host) and a terrible way to
    // find a typo. In-repo plugins get the typo caught here instead.
    // Scoped to the register call's own literal — `placement` is an ordinary word, and one
    // plugin uses it for chart indicator panes, which are not this seam's business.
    const placements = sources.flatMap(({ path, source }) =>
      [...source.matchAll(/statusItems\.register\(\s*\{[^)]*?placement:\s*'([^']+)'/gu)].map(
        (match) => ({ path, placement: match[1]! }),
      ),
    )
    // The scan has to actually be finding them, or this passes on an empty list forever.
    expect(placements.length).toBeGreaterThan(0)
    const unknown = placements
      .filter(({ placement }) => !STATUS_ITEM_PLACEMENTS.includes(placement))
      .map(({ path, placement }) => `${path}: ${placement}`)
    expect(unknown).toEqual([])
  })
})

/**
 * What a plugin's status-item module may cost, and what it may look like.
 *
 * Nine bundled plugins contribute one now, and all nine are enabled by default — so these rules
 * are not style, they are the only thing standing between a fresh install and nine plugins each
 * spending a request a second to keep a number in the chrome. Held here, once, rather than in nine
 * near-identical per-plugin structure tests.
 */
describe('contributed status items stay declarations', () => {
  const modules = pluginUiSources().filter(({ path }) => /\/statusItems?\.tsx?$/u.test(path))

  test('every plugin that contributes one has a module this scan reaches', () => {
    expect(modules.length).toBeGreaterThanOrEqual(8)
  })

  test('they declare, they do not draw', () => {
    // A `.ts` file cannot hold JSX, which is the cheapest possible proof that the host owns the
    // pixels. The class-name check catches the other half: styling passed as data.
    const drawing = modules
      .filter(({ path, source }) => path.endsWith('.tsx') || source.includes('className'))
      .map(({ path }) => path)
    expect(drawing).toEqual([])
  })

  test('none of them starts a poller', () => {
    // The contract's one hard cost rule. A status item reads what the plugin already knows; an
    // interval here is a background request per tick, per plugin, per session, forever — and the
    // thing it re-learns is usually something this app itself caused.
    const polling = modules
      .filter(({ source }) => /\bsetInterval\s*\(/u.test(source))
      .map(({ path }) => path)
    expect(polling).toEqual([])
  })

  test('none of them reaches into the host tree', () => {
    // `@/` is `apps/ui`. A status item that imported a host component would be drawing again by
    // another route, and would couple a plugin to core's file layout.
    const reaching = modules
      .filter(({ source }) => /from '@\//u.test(source))
      .map(({ path }) => path)
    expect(reaching).toEqual([])
  })
})
