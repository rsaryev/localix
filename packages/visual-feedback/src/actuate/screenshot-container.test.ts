/**
 * A whole-view shot of a scoped root clones that root, not the app around it.
 *
 * The defect: the context margin sent the rasterizer climbing ancestors until one covered the
 * panel plus 56px — the app shell — so `modern-screenshot` cloned the whole window. In WebKit its
 * per-image redraw pass then cost ~16 s a shot, and the browser command timed out at 22 s. An
 * element shot keeps its margin: that case is what the margin is for.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import type * as Actuate from './index'
import type * as Snapshot from '../snapshot/index'

const cloned: Element[] = []
void mock.module('modern-screenshot', () => ({
  domToCanvas: async (node: Element) => {
    cloned.push(node)
    return document.createElement('canvas')
  },
  domToJpeg: async () => 'data:image/jpeg;base64,',
}))

// Loaded after the mock is registered, so the rasterizer binds the recording double. The type
// imports are erased, so they do not load either module early.
let actuate: typeof Actuate
let snapshot: typeof Snapshot

/** Give an element a layout box; happy-dom lays nothing out. */
function place(el: Element, left: number, top: number, width: number, height: number): void {
  const rect = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...rect, toJSON: () => rect }),
  })
}

describe('screenshot container', () => {
  beforeAll(async () => {
    actuate = await import('./index')
    snapshot = await import('../snapshot/index')
    GlobalRegistrator.register()
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
  })
  afterAll(() => GlobalRegistrator.unregister())

  function shell() {
    document.body.innerHTML =
      '<div id="shell"><section id="pane"><div id="panel"><button id="card">Card</button></div></section></div>'
    const byId = (id: string) => document.getElementById(id)!
    place(byId('shell'), 0, 0, 1440, 1000)
    place(byId('pane'), 300, 40, 925, 1000)
    place(byId('panel'), 300, 40, 925, 960)
    place(byId('card'), 400, 200, 200, 40)
    return { panel: byId('panel'), card: byId('card'), shell: byId('shell') }
  }

  const deps = (root: Element) => ({
    reg: snapshot.createRefRegistry(),
    console: actuate.installConsoleCapture(),
    prevTree: { value: '' },
    settle: async () => {},
    root,
  })

  test('the whole view clones the scoped root itself', async () => {
    const { panel } = shell()
    cloned.length = 0
    await actuate.runCommand({ action: 'screenshot' }, deps(panel))
    expect(cloned).toEqual([panel])
  })

  test('an element shot still takes its context from around it', async () => {
    const { panel, card } = shell()
    cloned.length = 0
    await actuate.runCommand({ action: 'screenshot', selector: '#card' }, deps(panel))
    expect(cloned).toHaveLength(1)
    expect(cloned[0]).not.toBe(card)
    expect(cloned[0]!.contains(card)).toBe(true)
  })
})
