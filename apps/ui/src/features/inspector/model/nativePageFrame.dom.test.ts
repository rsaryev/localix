import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { visibleNativePageFrame } from './nativePageFrame'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())
afterEach(() => document.body.replaceChildren())

function box(element: HTMLElement, x: number, y: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  })
}
function fixture() {
  const pane = document.createElement('div')
  const host = document.createElement('div')
  pane.append(host)
  document.body.append(pane)
  box(pane, 50, 100, 300, 250)
  box(host, 20, 80, 800, 600)
  pane.style.overflow = 'hidden'
  return { pane, host }
}

test('native page bounds stay inside the pane even when its DOM host overflows', () => {
  const { host } = fixture()
  expect(visibleNativePageFrame(host)).toEqual({ x: 50, y: 100, width: 300, height: 250 })
})

test('clipping applies independently per axis and stays inside the window', () => {
  const { pane, host } = fixture()
  pane.style.overflow = 'visible'
  pane.style.overflowX = 'hidden'
  pane.style.overflowY = 'visible'
  box(host, -20, -30, window.innerWidth + 80, window.innerHeight + 90)
  expect(visibleNativePageFrame(host)).toEqual({
    x: 50,
    y: 0,
    width: 300,
    height: window.innerHeight,
  })
})

test('borders and scrollbars remain outside the native view, including a scaled pane', () => {
  const { pane, host } = fixture()
  for (const [name, value] of Object.entries({
    offsetWidth: 150,
    offsetHeight: 125,
    clientLeft: 1,
    clientTop: 1,
    clientWidth: 138,
    clientHeight: 113,
  }))
    Object.defineProperty(pane, name, { configurable: true, value })
  expect(visibleNativePageFrame(host)).toEqual({ x: 52, y: 102, width: 276, height: 226 })
})

test('hidden or inert ancestors hide a native page without changing its layout size', () => {
  const { pane, host } = fixture()
  for (const property of ['visibility', 'display', 'contentVisibility'] as const) {
    pane.style[property] = property === 'display' ? 'none' : 'hidden'
    expect(visibleNativePageFrame(host)).toBeNull()
    pane.style[property] = ''
  }
  pane.hidden = true
  expect(visibleNativePageFrame(host)).toBeNull()
  pane.hidden = false
  pane.style.opacity = '0'
  expect(visibleNativePageFrame(host)).toBeNull()
  pane.style.opacity = ''
  pane.inert = true
  expect(visibleNativePageFrame(host)).toBeNull()
})

test('detached, empty, fully clipped and invalid frames cannot reach the native bridge', () => {
  const { host } = fixture()
  box(host, 400, 100, 30, 30)
  expect(visibleNativePageFrame(host)).toBeNull()
  box(host, 80, 120, 0, 30)
  expect(visibleNativePageFrame(host)).toBeNull()
  box(host, Number.NaN, 120, 30, 30)
  expect(visibleNativePageFrame(host)).toBeNull()
  host.remove()
  expect(visibleNativePageFrame(host)).toBeNull()
})
