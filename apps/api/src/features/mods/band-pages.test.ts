import { describe, expect, test } from 'bun:test'
import type { ModsApi, On } from '@localixai/claude-plugin/mods'
import { hostWithMods } from './testing/testing-host'

/**
 * The band's pages: a mod that draws without calling `next(e)` hides the mods after it, as in
 * Claude Code; the band keeps that as its first page and offers what the hidden mods draw as more.
 */

type Fn = (props: Record<string, unknown>) => unknown
const ui = ($: ModsApi, e: unknown) =>
  ($.ui.resolve as (e: unknown) => { Text: Fn; Box: Fn; Button: Fn })(e)
const VIEW = { columns: 80, rows: 10 }

/** A mod that draws `text` alone: it never calls next. */
const replaces =
  (text: string) =>
  (on: On): void =>
    void on('ui.render', { component: 'AbovePrompt' }, ($, e) => ui($, e).Text({ children: text }))
/** A mod that draws `text` beside what the mods after it drew. */
const composes =
  (text: string) =>
  (on: On): void =>
    void on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) =>
      ui($, e).Box({ children: [ui($, e).Text({ children: text }), await next(e)] }),
    )
const passes = (on: On): void =>
  void on('ui.render', { component: 'AbovePrompt' }, (_$, e, next) => next(e))

const texts = (tree: unknown): string[] =>
  typeof tree === 'string'
    ? [tree]
    : Array.isArray(tree)
      ? tree.flatMap(texts)
      : tree && typeof tree === 'object'
        ? texts((tree as { children?: unknown }).children ?? [])
        : []

describe('the band’s pages', () => {
  test('a mod that does not call next hides the next one: its drawing is a second page', async () => {
    const { host } = await hostWithMods({
      replay: replaces('▶ Replay'),
      weather: composes('☁ Cloudy'),
      steps: replaces('next: run tests'),
    })
    const drawing = await host.band.render('s1', VIEW)
    expect(drawing.pages.map((page) => ({ mods: page.mods, texts: texts(page.tree) }))).toEqual([
      { mods: ['replay'], texts: ['▶ Replay'] },
      { mods: ['weather', 'steps'], texts: ['☁ Cloudy', 'next: run tests'] },
    ])
    // The first page is what Claude Code draws: the chain as it ran.
    expect(drawing.tree).toEqual(drawing.pages[0]!.tree)
  })

  test('mods that call next compose one page', async () => {
    const { host } = await hostWithMods({ weather: composes('☁ Cloudy'), steps: replaces('next') })
    const drawing = await host.band.render('s1', VIEW)
    expect(drawing.pages).toHaveLength(1)
    expect(drawing.pages[0]!.mods).toEqual(['weather', 'steps'])
  })

  test('a hidden mod that draws nothing adds no page', async () => {
    const { host } = await hostWithMods({ replay: replaces('▶ Replay'), quiet: passes })
    expect((await host.band.render('s1', VIEW)).pages.map((page) => page.mods)).toEqual([
      ['replay'],
    ])
  })

  test('at most four pages, however many mods replace the band', async () => {
    const mods = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => [name, replaces(name)]),
    )
    const { host } = await hostWithMods(mods)
    const drawing = await host.band.render('s1', VIEW)
    expect(drawing.pages.map((page) => texts(page.tree))).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  test('a press on the second page reaches the hidden mod’s control, not the first’s', async () => {
    const pressed: string[] = []
    const button = (name: string) => (on: On) =>
      void on('ui.render', { component: 'AbovePrompt' }, ($, e) =>
        ui($, e).Button({ label: 'Go', hotkey: '1', onPress: () => void pressed.push(name) }),
      )
    const { host } = await hostWithMods({ first: button('first'), second: button('second') })
    const drawing = await host.band.render('s1', VIEW)
    expect(drawing.pages).toHaveLength(2)
    expect(await host.band.interact('s1', { kind: 'press', element: 'Go', page: 1 })).toBe(true)
    expect(await host.band.interact('s1', { kind: 'press', element: 'Go' })).toBe(true)
    expect(pressed).toEqual(['second', 'first'])
    expect(await host.band.interact('s1', { kind: 'press', element: 'Go', page: 4 })).toBe(false)
  })
})
