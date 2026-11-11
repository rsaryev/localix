import { describe, expect, test } from 'bun:test'
import { hostWithMod } from './testing/testing-host'

/** A mod's panes: `$.ui.open`'s answer, focus and Escape, and where their events run. */

type Fn = (props: Record<string, unknown>) => unknown
const call = ($: any, path: string, ...args: unknown[]) => {
  const [namespace, name] = path.split('.') as [string, string]
  return ($[namespace]![name] as (...rest: unknown[]) => Promise<unknown>)(...args)
}

describe('mod panes', () => {
  test('$.ui.open places a pane, and focus brings it forward on the screen', async () => {
    const answers: unknown[] = []
    const { host, scope } = await hostWithMod((on) => {
      on('turn.start', async ($, e, next) => {
        answers.push(await call($, 'ui.open', { id: 'held', focus: true, closeOnEscape: true }))
        answers.push(await call($, 'ui.open', { id: 'quiet', title: 'Quiet' }))
        answers.push(await call($, 'ui.open', { id: 'bad', focus: false }).catch(String))
        answers.push(await call($, 'ui.panes'))
        return next(e)
      })
    })
    await scope.turnStart('hi', 't1')
    // The desktop app docks every pane a mod opens: none waits listed.
    expect(answers[0]).toEqual({ isPlaced: true })
    expect(answers[1]).toEqual({ isPlaced: true })
    expect(String(answers[2])).toContain('focus is true or left out')
    expect(answers[3]).toEqual([
      { id: 'held', isPlaced: true },
      { id: 'quiet', title: 'Quiet', isPlaced: true },
    ])
    const held = host.panes.list().find((pane) => pane.id === 'held')
    expect(held).toMatchObject({ plugin: 'm', closeOnEscape: true, focusRequest: 1 })
    expect(host.panes.list().find((pane) => pane.id === 'quiet')?.focusRequest).toBe(0)
  })

  test('a pane’s button runs in the conversation that opened it', async () => {
    const { host, scope } = await hostWithMod((on) => {
      on('turn.start', async ($, e, next) => {
        await call($, 'ui.open', { id: 'p', focus: true })
        return next(e)
      })
      on('ui.render', { component: 'Pane' }, ($, e) => {
        const { Button } = ($.ui.resolve as (e: unknown) => { Button: Fn })(e)
        return Button({
          label: 'Use',
          onPress: () => call($, 'prompt.fill', { text: 'from pane' }),
        })
      })
    })
    await scope.turnStart('hi', 't1')
    const [pane] = host.panes.list()
    await host.panes.render(pane!.instance, 'p')
    expect(await host.panes.interact(pane!.instance, 'p', { kind: 'press', element: 'Use' })).toBe(
      true,
    )
    expect(host.composer.view('s1').fills.map((fill) => fill.text)).toEqual(['from pane'])
  })

  test('the person’s close is ui.close with origin person, which a hook may refuse', async () => {
    const origins: unknown[] = []
    let refuse = true
    const { host, scope } = await hostWithMod((on) => {
      on('turn.start', async ($, e, next) => {
        await call($, 'ui.open', { id: 'p', focus: true })
        return next(e)
      })
      on('ui.close', (_$, e, next) => {
        origins.push((e as { origin: unknown }).origin)
        return refuse ? {} : next(e)
      })
    })
    await scope.turnStart('hi', 't1')
    const [pane] = host.panes.list()
    await host.panes.close(pane!.instance, 'p')
    expect(host.panes.list()).toHaveLength(1)
    refuse = false
    await host.panes.close(pane!.instance, 'p')
    expect(host.panes.list()).toHaveLength(0)
    expect(origins).toEqual([{ kind: 'person' }, { kind: 'person' }])
  })
})
