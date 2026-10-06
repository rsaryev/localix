import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { useNativeChromeInset } from './useNativeChromeInset'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('excludes measured native chrome and follows tab and fullscreen changes', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const html = document.documentElement
  const savedStyle = html.getAttribute('style')
  const savedNative = html.getAttribute('data-native-titlebar')
  const savedFullscreen = html.getAttribute('data-fullscreen')
  const host = document.createElement('div')
  const root = createRoot(host)
  const anchor = document.createElement('button')
  anchor.getBoundingClientRect = () => ({ bottom: 32 }) as DOMRect
  const anchorRef = { current: anchor }
  function Probe() {
    const { inset, sideOffset } = useNativeChromeInset(anchorRef)
    return (
      <output>
        {inset}:{sideOffset}
      </output>
    )
  }
  const update = async (change: () => void) => {
    await React.act(async () => {
      change()
      window.dispatchEvent(new Event('resize'))
      // Deliver the root's MutationObserver before checking the next render.
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  try {
    html.setAttribute('data-native-titlebar', 'true')
    html.setAttribute('data-fullscreen', 'false')
    html.style.setProperty('--titlebar-height', '32px')
    html.style.setProperty('--native-tabbar-height', '36px')
    await React.act(async () => root.render(<Probe />))
    expect(host.textContent).toBe('68:40')

    await update(() => html.style.setProperty('--native-tabbar-height', '28px'))
    expect(host.textContent).toBe('60:32')
    await update(() => {
      html.setAttribute('data-fullscreen', 'true')
    })
    expect(host.textContent).toBe('28:4')
    await update(() => html.style.setProperty('--native-tabbar-height', '0px'))
    expect(host.textContent).toBe('0:4')
    await update(() => {
      html.setAttribute('data-fullscreen', 'false')
    })
    expect(host.textContent).toBe('32:4')
    await update(() => {
      html.setAttribute('data-native-titlebar', 'false')
    })
    expect(host.textContent).toBe('0:4')
  } finally {
    await React.act(async () => root.unmount())
    for (const [attribute, value] of [
      ['style', savedStyle],
      ['data-native-titlebar', savedNative],
      ['data-fullscreen', savedFullscreen],
    ] as const) {
      if (value === null) html.removeAttribute(attribute)
      else html.setAttribute(attribute, value)
    }
  }
})
