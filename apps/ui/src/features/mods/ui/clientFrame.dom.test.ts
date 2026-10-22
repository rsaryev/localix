import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { buildClientFrameDoc, CLIENT_FRAME_CSP, jsonForScript } from './clientFrameDoc'
import { CLIENT_FRAME_DRAW } from './clientFrameDraw'
import { CLIENT_FRAME_RUNTIME } from './clientFrameRuntime'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
// The frame's boot (`window.__lxClient`) lands on globalThis here: each test removes its own.
afterEach(() => {
  delete (globalThis as { __lxClient?: unknown }).__lxClient
})
afterAll(async () => {
  await teardown()
})

type Surface = {
  elements: Record<string, (props: Record<string, unknown>) => unknown>
  state: number | undefined
  setState: (next: number) => void
  post: (data: unknown) => void
}

/**
 * Runs the frame's scripts against this document, as the frame would: its own globals (`h`, the
 * module's exports), a parent that records what the frame sends, and a frame clock the test runs.
 */
function boot(component: (props: unknown, surface: Surface) => unknown, props: unknown) {
  document.body.innerHTML = '<div id="root"></div>'
  const frames: Array<() => void> = []
  const sent: Array<{ type: string; payload?: unknown }> = []
  const parent = {
    postMessage: (message: { type: string; payload?: unknown }) => sent.push(message),
  }
  const scope: Record<string | symbol, unknown> = {
    [Symbol.for('localix.mods.client')]: { default: component },
  }
  ;(window as unknown as { __lxClient: unknown }).__lxClient = {
    code: '',
    props,
    frame: (fn: () => void) => frames.push(fn),
  }
  const run = new Function(
    'window',
    'document',
    'parent',
    'globalThis',
    `(function () { 'use strict';\n${CLIENT_FRAME_DRAW}\n${CLIENT_FRAME_RUNTIME}\n})()`,
  )
  run(window, document, parent, scope)
  const tick = () => frames.splice(0).forEach((fn) => fn())
  const fromHost = (type: string, payload: unknown) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { lx: 'mod-client', type, payload },
        source: parent as never,
      }),
    )
  return { sent, tick, fromHost, scope, root: document.getElementById('root')! }
}

test('a surface module draws, keeps its state across new props, and posts once per frame', () => {
  let calls = 0
  const { sent, tick, fromHost, root } = boot(
    (props, surface) => {
      calls++
      const { Box, Text, Button } = surface.elements
      const count = surface.state ?? 0
      return Box({
        children: [
          Text({ children: `speed ${(props as { speed: number }).speed} · ${count}` }),
          Button({
            key: 'more',
            label: 'More',
            onPress: () => {
              surface.setState(count + 1)
              surface.post({ count: count + 1 })
              surface.post({ count: count + 100 })
            },
          }),
        ],
      })
    },
    { speed: 2 },
  )
  expect(sent.map((message) => message.type)).toContain('ready')
  expect(root.textContent).toContain('speed 2 · 0')

  root.querySelector('button')!.click()
  tick()
  expect(root.textContent).toContain('speed 2 · 1')
  // The later post in one frame replaced the earlier one.
  expect(sent.filter((message) => message.type === 'post')).toEqual([
    { lx: 'mod-client', type: 'post', payload: { count: 100 } },
  ] as never)

  fromHost('props', { speed: 9 })
  tick()
  expect(root.textContent).toContain('speed 9 · 1')
  expect(calls).toBe(3)
})

test('a throw while drawing unmounts the instance and reports the fault', () => {
  const { sent, root } = boot(() => {
    throw new Error('boom')
  }, null)
  expect(root.textContent).toBe('')
  expect(sent.at(-1)).toMatchObject({ type: 'fault', payload: { phase: 'render', reason: 'boom' } })
})

test('a nested Client, a control without a key or a setState on every render is refused', () => {
  const nested = boot(
    (_, surface) => surface.elements.Box({ children: { type: 'Client', props: {}, children: [] } }),
    null,
  )
  expect(nested.sent.at(-1)).toMatchObject({
    payload: { phase: 'render', reason: 'a Client does not nest' },
  })

  const keyless = boot((_, surface) => surface.elements.Button({ label: 'x' }), null)
  expect(keyless.sent.at(-1)).toMatchObject({ payload: { reason: 'a Button has no key' } })

  const loop = boot((_, surface) => {
    surface.setState((surface.state ?? 0) + 1)
    return null
  }, null)
  loop.tick()
  loop.tick()
  expect(loop.sent.at(-1)).toMatchObject({
    payload: { phase: 'run', reason: expect.stringContaining('render loop') },
  })
})

test('a module with no component fails to load', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const sent: unknown[] = []
  ;(window as unknown as { __lxClient: unknown }).__lxClient = { code: '', props: null }
  new Function(
    'window',
    'document',
    'parent',
    'globalThis',
    `(function () {\n${CLIENT_FRAME_DRAW}\n${CLIENT_FRAME_RUNTIME}\n})()`,
  )(
    window,
    document,
    { postMessage: (message: unknown) => sent.push(message) },
    { [Symbol.for('localix.mods.client')]: { helper: () => null, lower: 1 } },
  )
  expect(sent.at(-1)).toMatchObject({ type: 'fault', payload: { phase: 'load' } })
})

test('the frame builds elements as `@localixai/claude-plugin/mods` does: frozen plain data', () => {
  const scope: Record<string, unknown> = {}
  new Function('scope', `${CLIENT_FRAME_DRAW}\nscope.h = h; scope.elements = elements;`)(scope)
  type Make = (tag: unknown, props: unknown, ...children: unknown[]) => unknown
  const h = scope.h as Make
  const table = scope.elements as Record<string, unknown>
  expect(Object.keys(table)).toEqual([
    'Box',
    'Text',
    'Button',
    'Input',
    'Select',
    'Link',
    'Code',
    'Markdown',
  ])
  const tree = h(table.Box, { gap: 1 }, h(table.Text, null, 'a', 1), h('Fragment', null, 'b'))
  expect(tree).toEqual({
    type: 'Box',
    props: { gap: 1 },
    children: [
      { type: 'Text', props: {}, children: ['a', 1] },
      { type: 'Fragment', props: {}, children: ['b'] },
    ],
  })
  expect(Object.isFrozen(tree)).toBe(true)
})

test('the frame document loads nothing, connects nowhere, and carries the code as data', () => {
  const doc = buildClientFrameDoc({
    code: 'var x = "</script><script>alert(1)</script>"',
    props: { a: 1 },
    fit: { width: true, height: true },
    theme: 'dark',
    themeCss: '--background: #000;',
  })
  expect(CLIENT_FRAME_CSP).toContain("default-src 'none'")
  expect(CLIENT_FRAME_CSP).toContain("connect-src 'none'")
  expect(doc).toContain(CLIENT_FRAME_CSP)
  expect(doc).not.toContain('</script><script>alert(1)')
  expect(jsonForScript('</script>\u2028')).toBe('"\\u003c/script>\\u2028"')
})

// Last in the file: the tests above booted frames, and none left its boot on globalThis, which
// the root run's globals guard (`scripts/test-globals-guard.ts`) would report as a leak.
test('a booted frame leaves no __lxClient on globalThis', () => {
  expect(Object.hasOwn(globalThis, '__lxClient')).toBe(false)
})
