import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('DevOps resource row pointer contract', () => {
  test('keeps child actions clickable while the remaining row surface stays draggable', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ResourceDragRow } = await import('./ResourceDragRow')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let actionClicks = 0
    let opens = 0

    try {
      await act(async () => {
        root.render(
          <ResourceDragRow
            uri="localix://resource/docker/image/sha256%3Aabc"
            label="api:latest"
            onOpen={() => {
              opens += 1
            }}
          >
            <button type="button" data-resource-drag-surface onClick={() => (opens += 1)}>
              api:latest
            </button>
            <button
              type="button"
              onClick={() => {
                actionClicks += 1
              }}
            >
              Remove
            </button>
          </ResourceDragRow>,
        )
      })

      const row = host.querySelector<HTMLElement>('[data-resource-uri]')!
      const primary = host.querySelector<HTMLButtonElement>('[data-resource-drag-surface]')!
      const action = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button !== primary,
      )!

      await act(async () => {
        action.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }),
        )
        const stolenDrag = new Event('dragstart', { bubbles: true, cancelable: true })
        row.dispatchEvent(stolenDrag)
        expect(stolenDrag.defaultPrevented).toBe(true)
        action.click()
      })
      expect(actionClicks).toBe(1)
      expect(opens).toBe(0)

      const payload = new Map<string, string>()
      const dataTransfer = {
        effectAllowed: 'none',
        get types() {
          return [...payload.keys()]
        },
        setData(type: string, value: string) {
          payload.set(type, value)
        },
      }
      await act(async () => {
        primary.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20 }),
        )
        const rowDrag = new Event('dragstart', { bubbles: true, cancelable: true })
        Object.defineProperty(rowDrag, 'dataTransfer', { value: dataTransfer })
        row.dispatchEvent(rowDrag)
        expect(rowDrag.defaultPrevented).toBe(false)
      })
      expect(payload.get('text/plain')).toBe(
        '@resource:localix://resource/docker/image/sha256%3Aabc',
      )
      expect(dataTransfer.effectAllowed).toBe('copy')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
