import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

// Zero-delay timer turns: the code under test schedules with `setTimeout(..., 0)`.
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Caches the realtime scheduler does not own still learn of changes from its topics: an SWR key
 * re-reads once per change however many components hold it.
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
})
