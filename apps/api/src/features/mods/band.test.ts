import { describe, expect, test } from 'bun:test'
import type { ModsApi } from '@localixai/claude-plugin/mods'
import { hostWithMod, hostWithMods } from './testing/testing-host'

/** The band above a conversation's prompt box (`AbovePrompt`), as a mod draws in it. */

type Ui = { Box: Fn; Text: Fn; Button: Fn }
type Fn = (props: Record<string, unknown>) => unknown
const ui = ($: ModsApi, e: unknown) => ($.ui.resolve as (e: unknown) => Ui)(e)

describe('the AbovePrompt band', () => {
  test('a mod draws the band with the site’s props; nobody drawing leaves no band', async () => {
    let seen: Record<string, unknown> | undefined
    const { host } = await hostWithMod((on) => {
      on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
        seen = e as Record<string, unknown>
        return ui($, e).Text({ children: 'forecast' })
      })
    })
    const drawing = await host.band.render('s1', { columns: 100, rows: 12 })
    expect(drawing.tree).toEqual([{ type: 'Text', props: {}, children: ['forecast'] }])
    expect(seen).toMatchObject({
      component: 'AbovePrompt',
      surface: 'desktop',
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 12,
        bodyColumns: 95,
        scroll: { bodyRows: 11, offset: 0 },
        view: {},
      },
    })

    const quiet = await hostWithMod((on) => on('ui.render', (_$, e, next) => next(e)))
    expect((await quiet.host.band.render('s1', { columns: 100, rows: 12 })).tree).toBeNull()
  })

  test('mods compose: next(e) gives the band the mods after it drew', async () => {
    const { host } = await hostWithMods({
      outer: (on) =>
        on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
          const below = await next(e)
          return ui($, e).Box({ children: [below, ui($, e).Text({ children: 'outer' })] })
        }),
      inner: (on) =>
        on('ui.render', { component: 'AbovePrompt' }, ($, e) =>
          ui($, e).Text({ children: 'inner' }),
        ),
    })
    const drawing = await host.band.render('s1', { columns: 80, rows: 10 })
    expect(drawing.tree).toEqual([
      {
        type: 'Box',
        props: {},
        children: [
          { type: 'Text', props: {}, children: ['inner'] },
          { type: 'Text', props: {}, children: ['outer'] },
        ],
      },
    ])
  })

  test('a press runs onPress with its ui.press argument, in the band’s conversation', async () => {
    const pressed: unknown[] = []
    const { host } = await hostWithMod((on) => {
      on('ui.render', { component: 'AbovePrompt' }, ($, e) =>
        ui($, e).Button({
          label: 'Fill',
          hotkey: '1',
          onPress: (press: unknown) => {
            pressed.push(press)
            return ($.prompt.fill as (input: unknown) => unknown)({ text: 'run the tests' })
          },
        }),
      )
    })
    const drawing = await host.band.render('s1', { columns: 80, rows: 10 })
    expect(drawing.tree?.[0]).toMatchObject({ props: { key: 'Fill', hotkey: '1' } })
    expect(await host.band.interact('s1', { kind: 'press', element: 'Fill' })).toBe(true)
    expect(pressed).toEqual([
      expect.objectContaining({
        element: 'Fill',
        component: 'AbovePrompt',
        surface: 'desktop',
        plugin: 'm',
      }),
    ])
    expect(host.composer.view('s1').fills.map((fill) => fill.text)).toEqual(['run the tests'])
    expect(await host.band.interact('s1', { kind: 'press', element: 'gone' })).toBe(false)
  })

  test('isWorking is true while the conversation’s turn runs', async () => {
    const working: unknown[] = []
    const { host, scope } = await hostWithMod((on) => {
      on('ui.render', { component: 'AbovePrompt' }, (_$, e, next) => {
        working.push((e as { props: { isWorking: boolean } }).props.isWorking)
        return next(e)
      })
    })
    scope.wrapTools([])
    await host.band.render('s1', { columns: 80, rows: 10 })
    await scope.turnComplete({ answer: '', turnId: 't', durationMs: 1, reason: 'answer' })
    await host.band.render('s1', { columns: 80, rows: 10 })
    expect(working).toEqual([true, false])
  })

  test('a conversation that ran no turn since Localix started draws its band in its own project', async () => {
    const { host, dir } = await hostWithMod(
      (on) => {
        on('ui.render', { component: 'AbovePrompt' }, async ($, e) =>
          ui($, e).Text({ children: await ($.session.cwd as () => Promise<string>)() }),
        )
      },
      { sessionCwd: async () => `${dir}/project` },
    )
    const drawing = await host.band.render('fresh', { columns: 80, rows: 10 })
    expect(drawing.tree).toEqual([{ type: 'Text', props: {}, children: [`${dir}/project`] }])
  })
})
