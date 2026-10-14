import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { REDUCED_MOTION_QUERY, useReducedMotion } from '@localixai/kit/environment'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('useReducedMotion shared media observer', () => {
  test('fans one live OS listener out to every mounted consumer', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const original = window.matchMedia
    const changeListeners = new Set<() => void>()
    let matches = false
    let addCount = 0
    let removeCount = 0

    const media = {
      media: REDUCED_MOTION_QUERY,
      get matches() {
        return matches
      },
      addEventListener(type: string, listener: () => void) {
        if (type !== 'change') return
        addCount++
        changeListeners.add(listener)
      },
      removeEventListener(type: string, listener: () => void) {
        if (type !== 'change') return
        removeCount++
        changeListeners.delete(listener)
      },
    } as unknown as MediaQueryList
    window.matchMedia = (query) => {
      expect(query).toBe(REDUCED_MOTION_QUERY)
      return media
    }

    function Probe() {
      return React.createElement('span', null, String(useReducedMotion()))
    }

    const host = document.createElement('div')
    const root = createRoot(host)
    let mounted = true
    try {
      await React.act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Probe),
            React.createElement(Probe),
          ),
        )
      })
      expect(host.textContent).toBe('falsefalse')
      expect(addCount).toBe(1)

      await React.act(async () => {
        matches = true
        for (const listener of changeListeners) listener()
      })
      expect(host.textContent).toBe('truetrue')

      await React.act(async () => root.render(React.createElement(Probe)))
      expect(removeCount).toBe(0)

      await React.act(async () => root.unmount())
      mounted = false
      expect(removeCount).toBe(1)
    } finally {
      if (mounted) await React.act(async () => root.unmount())
      window.matchMedia = original
    }
  })
})
