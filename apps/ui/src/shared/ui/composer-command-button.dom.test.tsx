import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { composerBus, type ComposerInsert } from '@/shared/lib/composerBus'
import { registerDom } from '@localixai/kit/testing/dom'
import { ComposerCommandButton } from './composer-command-button'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('ComposerCommandButton', () => {
  test('stages its command through the shared composer bus', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const requests: ComposerInsert[] = []
    const unsubscribe = composerBus.subscribe((request) => {
      requests.push(request)
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ComposerCommandButton
          command="/sample-extension:create"
          insertText="/sample-extension:create "
          sessionId="session-1"
        />,
      )
    })

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      text: '/sample-extension:create ',
      sessionId: 'session-1',
      buffer: true,
    })

    await act(async () => root.unmount())
    container.remove()
    unsubscribe()
  })

  test('without an explicit session it addresses the chat it is shown in, and with none it is inert', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
    const requests: ComposerInsert[] = []
    const unsubscribe = composerBus.subscribe((request) => {
      requests.push(request)
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <>
          <WorkItemSessionProvider sessionId="session-A">
            <ComposerCommandButton command="/a" />
          </WorkItemSessionProvider>
          <ComposerCommandButton command="/none" />
        </>,
      )
    })
    const [owned, orphan] = Array.from(container.querySelectorAll('button'))
    await act(async () => {
      owned?.click()
      orphan?.click()
    })

    expect(orphan?.disabled).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ text: '/a', sessionId: 'session-A' })

    await act(async () => root.unmount())
    container.remove()
    unsubscribe()
  })
})
