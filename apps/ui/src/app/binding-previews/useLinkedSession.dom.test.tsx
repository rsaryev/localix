import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'

/** A preview's module cache is keyed by the tab-wide 'sessions' generation. */
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  await teardown()
})

const settle = () => new Promise((done) => setTimeout(done, 10))

describe('linked session previews', () => {
  test('a linked session preview is read again after the sessions topic fires', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { resourceSync } = await import('@/shared/api/resourceSync')
    const { backendClient } = await import('@/shared/api/client')
    const { useLinkedSession } = await import('./useLinkedSession')
    let title = 'Before'
    const read = spyOn(backendClient, 'getSession').mockImplementation(
      async (id: string) => ({ id, title, messages: [] }) as unknown as UiSession,
    )
    function Preview() {
      const linked = useLinkedSession('unlisted-session')
      return <span>{linked.state === 'ready' ? linked.session.title : linked.state}</span>
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(<Preview />)
        await settle()
      })
      expect(host.textContent).toBe('Before')
      title = 'After'
      await act(async () => {
        resourceSync.invalidate(['sessions'])
        await settle()
      })
      expect(host.textContent).toBe('After')
      expect(read).toHaveBeenCalledTimes(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      read.mockRestore()
    }
  })
})
