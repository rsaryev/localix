import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import {
  DEFAULT_KEY_POLICY,
  offerKeyToFocusedSurface,
  useFocusStack,
} from '@localixai/mini-app-sdk/ui/focus'
import { EDGE_KINDS } from '../shared/model'
import type { GraphSnapshot } from '../shared/view'
import type { GraphState } from './useGraph'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('Code Graph keys stay inside the pane and yield to fields and overlays', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Toolbar } = await import('./Toolbar')
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  let back = 0
  let forward = 0
  const graph = {
    kinds: new Set(EDGE_KINDS),
    external: false,
    query: '',
    sending: false,
    canBack: true,
    canForward: true,
    back: () => {
      back += 1
    },
    forward: () => {
      forward += 1
    },
    setQuery: () => {},
    setExternal: () => {},
    toggleKind: () => {},
    reindex: () => {},
  } as unknown as GraphState
  const snapshot = { status: { state: 'ready' }, search: [] } as unknown as GraphSnapshot
  const route = (event: KeyboardEvent) => {
    offerKeyToFocusedSurface(event)
  }
  window.addEventListener('keydown', route)
  const press = (target: Element, key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    // happy-dom aliases AltGraph to Alt; these are ordinary Alt navigation events.
    Object.defineProperty(event, 'getModifierState', { value: () => false })
    target.dispatchEvent(event)
    return event
  }
  try {
    await act(async () =>
      root.render(
        <div data-code-graph-root>
          <Toolbar
            graph={graph}
            snapshot={snapshot}
            inspectorOpen={false}
            onToggleInspector={() => {}}
            crumbs={[]}
            onLeaveTo={() => {}}
            onPick={() => {}}
          />
          <div data-canvas />
        </div>,
      ),
    )
    const canvas = host.querySelector('[data-canvas]')!
    const search = host.querySelector<HTMLInputElement>('input')!
    expect(press(document.body, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false)
    expect(press(search, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false)
    expect(press(canvas, 'ArrowLeft', { altKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    )
    expect({ back, forward }).toEqual({ back: 0, forward: 0 })
    expect(press(canvas, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(true)
    expect(press(canvas, 'ArrowRight', { altKey: true }).defaultPrevented).toBe(true)
    expect({ back, forward }).toEqual({ back: 1, forward: 1 })
    press(canvas, '/')
    expect(document.activeElement).toBe(search)
    useFocusStack
      .getState()
      .push({ id: 'test-modal', kind: 'dialog', keyboard: DEFAULT_KEY_POLICY.dialog })
    press(canvas, 'ArrowLeft', { altKey: true })
    expect(back).toBe(1)
  } finally {
    useFocusStack.getState().release('test-modal')
    window.removeEventListener('keydown', route)
    await act(async () => root.unmount())
    host.remove()
  }
})
