import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'

/**
 * Caches the realtime scheduler does not own still learn of changes from its topics: an SWR key
 * re-reads once per change however many components hold it, and a module cache keyed by the
 * tab-wide generation never serves a read made before the change.
 */
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

describe('topic-driven caches', () => {
  test('an SWR key re-reads once per change for every reader', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: useSWR } = await import('swr')
    const { resourceSync } = await import('./resourceSync')
    const { useRevalidateOnResources } = await import('./resourceGeneration')
    let reads = 0
    function Reader() {
      useRevalidateOnResources('test:topic-key', ['providers'])
      const { data } = useSWR('test:topic-key', async () => ++reads, { dedupingInterval: 0 })
      return <span>{data ?? 0}</span>
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          <>
            <Reader />
            <Reader />
          </>,
        )
        await settle()
      })
      const before = reads
      await act(async () => {
        resourceSync.invalidate(['providers'])
        await settle()
      })
      expect(reads).toBe(before + 1)
      expect(host.textContent).toBe(`${reads}${reads}`)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('a linked session preview is read again after the sessions topic fires', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { resourceSync } = await import('./resourceSync')
    const { backendClient } = await import('./client')
    const { useLinkedSession } = await import('@/app/binding-previews/useLinkedSession')
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
