import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  const style = document.createElement('style')
  style.textContent = readFileSync(new URL('../../styles/chrome.css', import.meta.url), 'utf8')
  document.head.appendChild(style)
})

afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset.windowInactive
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.nativeTitlebar
  delete document.documentElement.dataset.fullscreen
  document.documentElement.removeAttribute('style')
})

afterAll(async () => {
  await teardown()
})

for (const theme of ['dark', 'light']) {
  test(`${theme}: focus loss dims controls without thinning the titlebar ground`, () => {
    document.documentElement.dataset.theme = theme
    const bar = document.createElement('div')
    bar.className = 'app-titlebar'
    const control = document.createElement('span')
    control.textContent = 'Workspace'
    bar.appendChild(control)
    document.body.appendChild(bar)

    document.documentElement.dataset.windowInactive = 'true'
    expect(getComputedStyle(bar).opacity).not.toBe('0.6')
    expect(getComputedStyle(control).opacity).toBe('0.6')

    delete document.documentElement.dataset.windowInactive
    // Happy DOM caches descendant styles when an ancestor's dataset changes.
    // Mount fresh nodes to inspect the active selector independently.
    const activeBar = bar.cloneNode(true) as HTMLElement
    bar.replaceWith(activeBar)
    expect(getComputedStyle(activeBar).opacity).not.toBe('0.6')
    expect(getComputedStyle(activeBar.firstElementChild!).opacity).not.toBe('0.6')
  })
}

test('native tabs reserve their measured band and the toolbar clears the real buttons', () => {
  const root = document.documentElement
  root.dataset.nativeTitlebar = 'true'
  root.style.setProperty('--native-tabbar-height', '36px')
  root.style.setProperty('--native-window-button-gap', '77px')
  const bar = document.createElement('div')
  bar.className = 'app-titlebar'
  const tabs = document.createElement('div')
  tabs.className = 'app-native-tabbar-space'
  document.body.append(bar, tabs)
  expect(getComputedStyle(bar).paddingLeft).toBe('77px')
  expect(getComputedStyle(tabs).height).toBe('36px')
  expect(getComputedStyle(tabs).display).toBe('block')
})

test('browser windows have no native tab band', () => {
  const tabs = document.createElement('div')
  tabs.className = 'app-native-tabbar-space'
  document.body.appendChild(tabs)
  expect(getComputedStyle(tabs).display).toBe('none')
})

test('fullscreen places visible native tabs above the toolbar without a button gap', () => {
  document.documentElement.dataset.nativeTitlebar = 'true'
  document.documentElement.dataset.fullscreen = 'true'
  const bar = document.createElement('div')
  bar.className = 'app-titlebar'
  const tabs = document.createElement('div')
  tabs.className = 'app-native-tabbar-space'
  document.body.append(bar, tabs)
  expect(getComputedStyle(bar).paddingLeft).toBe('8px')
  expect(getComputedStyle(tabs).order).toBe('-1')
})
