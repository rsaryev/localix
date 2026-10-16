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

// A warm tab stays mounted while it is parked. A prose comment layer that kept measuring its
// text while hidden would run a ResizeObserver for every parked tab, so observation must follow
// `active`: none while parked, one per selection, and a disconnect when it is parked again.
describe('warm-hidden text comment interactions', () => {
  test('layout observation waits for selection and disconnects while parked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { TextCommentLayer } = await import('@/shared/ui/comments/text-comment-layer')

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

    function Surface({ visible }: { visible: boolean }) {
      return (
        <TextCommentLayer
          comments={[]}
          onAdd={() => {}}
          onUpdate={() => {}}
          onRemove={() => {}}
          active={visible}
        >
          <p>Review the implementation.</p>
        </TextCommentLayer>
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
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })
})
