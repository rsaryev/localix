import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('HITL keyboard ownership', () => {
  test('only the focused warm frame handles global Enter and Escape', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { HitlInteractionFrame } = await import('./HitlInteractionFrame')
    const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let hiddenSubmits = 0
    let hiddenDismisses = 0
    let focusedSubmits = 0
    let focusedDismisses = 0

    try {
      await act(async () => {
        root.render(
          <ActionRegistryProvider>
            <HitlInteractionFrame
              title="Hidden"
              keyboardActive={false}
              onSubmit={() => {
                hiddenSubmits += 1
              }}
              onDismiss={() => {
                hiddenDismisses += 1
              }}
              footer={null}
            >
              hidden
            </HitlInteractionFrame>
            <HitlInteractionFrame
              title="Focused"
              keyboardActive
              onSubmit={() => {
                focusedSubmits += 1
              }}
              onDismiss={() => {
                focusedDismisses += 1
              }}
              footer={null}
            >
              focused
            </HitlInteractionFrame>
          </ActionRegistryProvider>,
        )
      })

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })

      expect({ hiddenSubmits, hiddenDismisses }).toEqual({
        hiddenSubmits: 0,
        hiddenDismisses: 0,
      })
      expect({ focusedSubmits, focusedDismisses }).toEqual({
        focusedSubmits: 1,
        focusedDismisses: 1,
      })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('an open inbox owns keys over an active frame behind it', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { HitlInteractionFrame } = await import('./HitlInteractionFrame')
    const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let behind = 0
    let inbox = 0

    try {
      await act(async () => {
        root.render(
          <ActionRegistryProvider>
            <HitlInteractionFrame
              title="Behind dialog"
              keyboardActive
              onSubmit={() => {
                behind += 1
              }}
              onDismiss={() => {}}
              footer={null}
            >
              behind
            </HitlInteractionFrame>
            <div role="dialog" data-state="open">
              <HitlInteractionFrame
                title="Inbox"
                keyboardActive
                onSubmit={() => {
                  inbox += 1
                }}
                onDismiss={() => {}}
                footer={null}
              >
                inbox
              </HitlInteractionFrame>
            </div>
          </ActionRegistryProvider>,
        )
      })

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      })
      expect({ behind, inbox }).toEqual({ behind: 0, inbox: 1 })
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('an open inbox keeps keyboard ownership when its root ref is replaced', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { HitlInteractionFrame } = await import('./HitlInteractionFrame')
    const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const firstRef = React.createRef<HTMLDivElement>()
    const secondRef = React.createRef<HTMLDivElement>()
    let submits = 0

    const frame = (rootRef: React.RefObject<HTMLDivElement | null>) => (
      <ActionRegistryProvider>
        <HitlInteractionFrame
          title="Inbox"
          keyboardActive
          rootRef={rootRef}
          onSubmit={() => {
            submits += 1
          }}
          onDismiss={() => {}}
          footer={null}
        >
          inbox
        </HitlInteractionFrame>
      </ActionRegistryProvider>
    )

    try {
      await act(async () => root.render(frame(firstRef)))
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      })
      expect(submits).toBe(1)

      await act(async () => root.render(frame(secondRef)))
      expect(firstRef.current).toBeNull()
      expect(secondRef.current?.getAttribute('aria-label')).toBe('Inbox')

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
      })
      expect(submits).toBe(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
