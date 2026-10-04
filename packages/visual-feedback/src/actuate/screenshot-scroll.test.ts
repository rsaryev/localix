/**
 * A whole-page screenshot must not move the page.
 *
 * The host photographs the live preview in the background (to keep a last frame for the
 * dormant pane), and it asks for the page root. Centering THAT scrolls a tall page to its
 * middle under the person reading it — for nothing: the rasterizer renders the DOM, and it
 * clamps its crop to the viewport either way. Centering a small element is still right.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

import { installConsoleCapture, runCommand, type ActuateDeps } from './index'
import { createRefRegistry } from '../snapshot/index'

const deps = (): ActuateDeps => ({
  reg: createRefRegistry(),
  console: installConsoleCapture(),
  prevTree: { value: '' },
  settle: async () => {},
})

/** Record scrollIntoView calls on one element; happy-dom's own is a no-op. */
function watchScroll(el: Element): { calls: number } {
  const seen = { calls: 0 }
  Object.defineProperty(el, 'scrollIntoView', {
    configurable: true,
    value: () => {
      seen.calls++
    },
  })
  return seen
}

describe('screenshot scroll side effects', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
    // happy-dom ships no font-loading API; the rasterizer awaits it before measuring.
    // It then bails on the zero-sized layout, which is all this test needs — the
    // question here is whether the page moved, not what the JPEG looks like.
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
  })
  afterAll(() => GlobalRegistrator.unregister())

  test('leaves the scroll position alone for a page-root shot', async () => {
    document.body.innerHTML = '<div id="tall" style="height:5000px">page</div>'
    const body = watchScroll(document.body)

    const implicit = await runCommand({ action: 'screenshot' }, deps())
    const explicit = await runCommand({ action: 'screenshot', selector: 'body' }, deps())

    expect(implicit.ok).toBe(true)
    expect(explicit.ok).toBe(true)
    expect(body.calls).toBe(0)
  })

  test('still centers a targeted element', async () => {
    document.body.innerHTML =
      '<div id="tall" style="height:5000px"><button id="go">Go</button></div>'
    const button = watchScroll(document.getElementById('go')!)

    const reply = await runCommand({ action: 'screenshot', selector: '#go' }, deps())

    expect(reply.ok).toBe(true)
    expect(button.calls).toBe(1)
  })
})
