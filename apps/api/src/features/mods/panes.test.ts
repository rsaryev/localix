import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { defaultErrorHandler } from '@localixai/mini-app-sdk/backend'
import { createModRoutes } from './routes'
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
    // No screen has said it shows either: neither is in view.
    expect(answers[3]).toEqual([
      { id: 'held', title: 'held', isPlaced: true, isShown: false, isFocused: false },
      { id: 'quiet', title: 'Quiet', isPlaced: true, isShown: false, isFocused: false },
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

  test('the pane the screen reports in view, and the one with the keyboard, are what $.ui.panes says', async () => {
    const answers: unknown[] = []
    const drawn: unknown[] = []
    const { host, scope } = await hostWithMod((on) => {
      on('turn.start', async ($, e, next) => {
        if (answers.length === 0) {
          await call($, 'ui.open', { id: 'a', title: 'A' })
          await call($, 'ui.open', { id: 'b', title: 'B' })
        }
        answers.push(await call($, 'ui.panes'))
        return next(e)
      })
      on('ui.render', { component: 'Pane' }, (_$, e) => {
        drawn.push((e as { props: { isFocused: unknown } }).props.isFocused)
        return null
      })
    })
    const app = new Hono().route('/', createModRoutes(host))
    app.onError(defaultErrorHandler)
    const screen = (body: unknown) =>
      app.request('/panes/screen', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    await scope.turnStart('hi', 't1')
    const instance = host.panes.list()[0]!.instance
    expect((await screen({ shown: [{ instance }] })).status).toBe(400)
    expect((await screen({ shown: [{ instance, id: 'a' }], focused: null })).status).toBe(200)
    await scope.turnStart('again', 't2')
    await screen({ shown: [{ instance, id: 'b' }], focused: { instance, id: 'b' } })
    await scope.turnStart('more', 't3')
    await host.panes.render(instance, 'a')
    await host.panes.render(instance, 'b')
    expect(answers.slice(1)).toEqual([
      [
        { id: 'a', title: 'A', isPlaced: true, isShown: true, isFocused: false },
        { id: 'b', title: 'B', isPlaced: true, isShown: false, isFocused: false },
      ],
      [
        { id: 'a', title: 'A', isPlaced: true, isShown: false, isFocused: false },
        { id: 'b', title: 'B', isPlaced: true, isShown: true, isFocused: true },
      ],
    ])
    // The Pane site hears whether its pane holds the keyboard.
    expect(drawn).toEqual([false, true])
  })
})
