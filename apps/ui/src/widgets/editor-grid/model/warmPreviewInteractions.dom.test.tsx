import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('warm-hidden preview interactions', () => {
  test('the one-time intro ignores global Escape while its preview is parked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { PreviewIntro } = await import('@/features/inspector/ui/PreviewIntro')
    // The intro's Escape now arrives through the shared dispatcher, so the test mounts
    // the same provider the app does instead of relying on a listener of the component's own.
    const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')

    let browseCalls = 0
    function Surface({ active }: { active: boolean }) {
      return (
        <ActionRegistryProvider>
          <PreviewIntro
            active={active}
            vfAvailable
            onBrowse={() => {
              browseCalls += 1
            }}
            onComment={() => {}}
          />
        </ActionRegistryProvider>
      )
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Surface active={false} />))
      host
        .querySelector('button')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      expect(browseCalls).toBe(0)

      await act(async () => root.render(<Surface active />))
      host
        .querySelector('button')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      expect(browseCalls).toBe(1)

      await act(async () => root.render(<Surface active={false} />))
      host
        .querySelector('button')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      expect(browseCalls).toBe(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('comment composer measurement waits for the preview body', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { AnchoredCommentCard } = await import('@/shared/ui/comments/AnchoredCommentCard')

    const OriginalResizeObserver = globalThis.ResizeObserver
    let created = 0
    let disconnected = 0
    class CountingResizeObserver {
      constructor(_callback: ResizeObserverCallback) {
        created += 1
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected += 1
      }
    }
    globalThis.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver

    const draft = {
      note: '',
      setNote: () => {},
      attachments: [],
      gate: { allowImages: true, allowPdf: true, allowAudio: true, allowDocuments: true },
      addFiles: () => {},
      removeAttachment: () => {},
      reset: () => {},
    }
    function Surface({ active }: { active: boolean }) {
      return (
        <AnchoredCommentCard
          active={active}
          anchor={{ x: 8, y: 8, width: 80, height: 24 }}
          bounds={{ width: 640, height: 480 }}
          label="Comment on Submit button"
          draft={draft}
          onSubmit={() => {}}
          onCancel={() => {}}
        />
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface active={false} />))
      expect(created).toBe(0)

      await act(async () => root.render(<Surface active />))
      expect(created).toBe(1)

      await act(async () => root.render(<Surface active={false} />))
      expect(disconnected).toBe(1)

      await act(async () => root.render(<Surface active />))
      expect(created).toBe(2)
    } finally {
      await act(async () => root.unmount())
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })

  test('split-scroll observation disconnects while the file tab is parked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act, useEffect } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { useSplitScrollSync } = await import('@/features/inspector/ui/useSplitScrollSync')

    const OriginalMutationObserver = globalThis.MutationObserver
    let created = 0
    let disconnected = 0
    class CountingMutationObserver {
      constructor(_callback: MutationCallback) {
        created += 1
      }
      observe() {}
      takeRecords() {
        return []
      }
      disconnect() {
        disconnected += 1
      }
    }
    globalThis.MutationObserver = CountingMutationObserver as unknown as typeof MutationObserver

    function SplitSurface() {
      const { splitView, toggleSplit, setPreviewEl } = useSplitScrollSync()
      useEffect(() => {
        if (!splitView) toggleSplit()
      }, [splitView, toggleSplit])
      return <div ref={setPreviewEl} />
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <SplitSurface />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface visible={false} />))
      expect(created).toBe(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(1)

      await act(async () => root.render(<Surface visible={false} />))
      expect(disconnected).toBe(1)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(2)
    } finally {
      await act(async () => root.unmount())
      globalThis.MutationObserver = OriginalMutationObserver
    }
  })
})
