import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

import type { ReaderBookSummary, ReaderLibraryResponse } from '../shared/contracts'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function book(title: string, updatedAt: string): ReaderBookSummary {
  return { path: `/books/${title}.epub`, title, format: 'epub', size: 1, updatedAt }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useReaderLibraryBooks', () => {
  test('keeps the latest successful shelf across races, errors, and source changes', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useReaderLibraryBooks } = await import('./useReaderLibraryBooks')
    const requests: Array<ReturnType<typeof deferred<ReaderLibraryResponse>>> = []
    const loadLibrary = () => {
      const request = deferred<ReaderLibraryResponse>()
      requests.push(request)
      return request.promise
    }
    let refresh: (() => Promise<boolean>) | null = null

    function Probe({ source }: { source: string }) {
      const snapshot = useReaderLibraryBooks(source, loadLibrary)
      // Read by the test once the commit is done, not written while rendering.
      React.useEffect(() => {
        refresh = snapshot.refresh
      })
      return <output>{snapshot.books.map((item) => item.title).join(',')}</output>
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Probe source="first" />))
      expect(requests).toHaveLength(1)

      let latestRefresh!: Promise<boolean>
      await act(async () => {
        latestRefresh = refresh!()
      })
      expect(requests).toHaveLength(2)

      await act(async () => {
        requests[1]!.resolve({
          books: [book('Fresh', '2026-08-15T12:00:00.000Z')],
          collections: [],
        })
        expect(await latestRefresh).toBe(true)
      })
      expect(host.textContent).toBe('Fresh')

      await act(async () => {
        requests[0]!.resolve({
          books: [book('Stale', '2026-08-15T11:00:00.000Z')],
          collections: [],
        })
        await requests[0]!.promise
      })
      expect(host.textContent).toBe('Fresh')

      let failedRefresh!: Promise<boolean>
      await act(async () => {
        failedRefresh = refresh!()
        requests[2]!.reject(new Error('temporary failure'))
        expect(await failedRefresh).toBe(false)
      })
      expect(host.textContent).toBe('Fresh')

      await act(async () => root.render(<Probe source="second" />))
      expect(requests).toHaveLength(4)
      await act(async () => {
        requests[3]!.resolve({
          books: [book('Second', '2026-08-15T13:00:00.000Z')],
          collections: [],
        })
        await requests[3]!.promise
      })
      expect(host.textContent).toBe('Second')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
