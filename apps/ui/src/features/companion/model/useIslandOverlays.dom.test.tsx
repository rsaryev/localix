import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { setTimeout as nativeTimeout, clearTimeout as clearNativeTimeout } from 'node:timers'
import { ISLAND_OVERLAY_SELECTOR } from './islandOverlays'
import { useIslandOverlays } from './useIslandOverlays'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('portaled composer menus hold native hit testing and release on folding', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const grabs: boolean[] = []
  let onGrab: ((grab: boolean) => void) | undefined
  ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: async (command: string, args: { grab: boolean }) => {
        if (command === 'companion_set_grab') {
          grabs.push(args.grab)
          onGrab?.(args.grab)
        }
      },
    },
  }
  function Host({ expanded }: { expanded: boolean }) {
    useIslandOverlays(expanded)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  const expectGrabAfter = async (expected: boolean, change: () => void) => {
    await React.act(async () => {
      await new Promise<void>((resolve, reject) => {
        const deadline = nativeTimeout(() => {
          onGrab = undefined
          const overlays = [...document.querySelectorAll(ISLAND_OVERLAY_SELECTOR)].map((el) => ({
            role: el.getAttribute('role'),
            state: el.getAttribute('data-state'),
          }))
          reject(
            new Error(
              `Expected grab=${expected}; calls=${JSON.stringify(grabs)}; overlays=${JSON.stringify(overlays)}`,
            ),
          )
        }, 1000)
        onGrab = (grab) => {
          if (grab !== expected) return
          clearNativeTimeout(deadline)
          onGrab = undefined
          resolve()
        }
        change()
      })
    })
    expect(grabs.at(-1)).toBe(expected)
  }
  try {
    await React.act(async () => root.render(<Host expanded />))
    await expectGrabAfter(true, () => document.body.append(menu))
    await expectGrabAfter(false, () => {
      menu.setAttribute('data-state', 'closed')
    })
    await expectGrabAfter(true, () => {
      menu.setAttribute('data-state', 'open')
    })
    await React.act(async () => root.render(<Host expanded={false} />))
    expect(grabs.at(-1)).toBe(false)
  } finally {
    menu.remove()
    await React.act(async () => root.unmount())
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
  }
})
