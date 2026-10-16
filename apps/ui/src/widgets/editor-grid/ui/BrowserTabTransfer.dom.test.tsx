import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('an inner page drag publishes an edge destination and forwards dragend through the typed port', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useTabPanelIds } = await import('@localixai/kit/tabs')
  const { BrowserTabStrip } = await import('@/features/inspector/ui/BrowserTabStrip')
  const { WorkspaceTabTransferTargets } = await import('./WorkspaceTabTransferTargets')
  const { browserTabTransferBus } = await import('@/shared/lib/browserTabTransferBus')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const ended: Array<{ pageId: string; cancelled: boolean }> = []
  const moved: Array<{ pageId: string; destination: string }> = []
  const restore = browserTabTransferBus.register({
    available: () => true,
    move: async (page, destination) => {
      moved.push({ pageId: page.pageId, destination })
      return true
    },
    finishOutside: async (page, _event, cancelled) => {
      ended.push({ pageId: page.pageId, cancelled })
    },
  })
  function Harness() {
    const tabIds = useTabPanelIds('browser-transfer-evidence')
    return (
      <>
        <BrowserTabStrip
          sessionId="session"
          tabs={[{ previewId: 'page', url: 'https://example.com', version: 1 }]}
          activeId="page"
          newTabOpen
          tabIds={tabIds}
          onSelect={() => {}}
          onNewTab={() => {}}
          onOpenHistory={() => {}}
        />
        <WorkspaceTabTransferTargets />
      </>
    )
  }
  const transfer = {
    effectAllowed: 'move',
    dropEffect: 'none',
    clearData() {},
    setData() {},
    setDragImage() {},
  }
  const dispatch = async (element: Element, type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    await act(async () => {
      element.dispatchEvent(event)
    })
  }
  try {
    await act(async () => root.render(<Harness />))
    const tabs = host.querySelectorAll('[role="tab"]')
    await dispatch(tabs[0]!, 'dragstart')
    expect(browserTabTransferBus.get().drag).toEqual({ sessionId: 'session', pageId: 'page' })
    await dispatch(tabs[0]!, 'dragend')
    expect(ended).toEqual([{ pageId: 'page', cancelled: false }])
    expect(browserTabTransferBus.get().drag).toBeNull()
    await dispatch(tabs[0]!, 'dragstart')
    const side = host.querySelector('[data-workspace-transfer-target="right"]')!
    expect(side).not.toBeNull()
    await dispatch(side, 'dragover')
    expect(side.getAttribute('data-drop-active')).toBe('true')
    const child = side.querySelector('svg')!
    const leave = new Event('dragleave', { bubbles: true })
    Object.defineProperty(leave, 'relatedTarget', { value: child })
    await act(async () => side.dispatchEvent(leave))
    expect(side.getAttribute('data-drop-active')).toBe('true')
    await dispatch(side, 'drop')
    await dispatch(tabs[0]!, 'dragend')
    expect(moved).toEqual([{ pageId: 'page', destination: 'window' }])
    expect(ended[1]?.cancelled).toBe(true)
    await dispatch(tabs[0]!, 'dragstart')
    const top = host.querySelector('[data-workspace-transfer-target="top"]')!
    await dispatch(top, 'dragover')
    expect(top.getAttribute('data-drop-active')).toBe('true')
    await dispatch(top, 'drop')
    await dispatch(tabs[0]!, 'dragend')
    expect(moved[1]).toEqual({ pageId: 'page', destination: 'tab' })
    expect(host.querySelector('[data-workspace-transfer-targets]')).toBeNull()
    await dispatch(tabs[1]!, 'dragstart')
    expect(browserTabTransferBus.get().drag).toBeNull()
    await dispatch(tabs[1]!, 'dragend')
    expect(ended).toHaveLength(3)
  } finally {
    await act(async () => root.unmount())
    restore()
    browserTabTransferBus.end()
    host.remove()
  }
})
