import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { RequestResponse } from '../../backend/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function response(name: string): RequestResponse {
  return {
    request: {
      name,
      createdAt: 1,
      updatedAt: 1,
      spec: {
        url: `https://example.test/${name}`,
        method: 'GET',
        headers: [],
        query: [],
        auth: { type: 'none' },
      },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('useRequest request ownership', () => {
  test('development StrictMode starts one initial request', async () => {
    const React = await import('react')
    const { StrictMode, act } = React
    const { createRoot } = await import('react-dom/client')
    const { restApi } = await import('../restApi')
    const { useRequest } = await import('./useRequest')

    const originalGet = restApi.get.bind(restApi)
    let calls = 0
    restApi.get = async () => {
      calls += 1
      return new Promise(() => {})
    }

    function Harness() {
      useRequest('session-a', 'alpha')
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <Harness />
          </StrictMode>,
        )
      })
      expect(calls).toBe(1)
    } finally {
      await act(async () => root.unmount())
      restApi.get = originalGet
    }
  })

  test('a late response for the previous name cannot replace the current request', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { restApi } = await import('../restApi')
    const { useRequest } = await import('./useRequest')

    const originalGet = restApi.get.bind(restApi)
    const reads = new Map<string, ReturnType<typeof deferred<RequestResponse>>>()
    const sessions: string[] = []
    restApi.get = (sessionId, name) => {
      sessions.push(sessionId)
      const read = deferred<RequestResponse>()
      reads.set(name, read)
      return read.promise
    }
    let currentName: string | undefined

    function Harness({ name }: { name: string }) {
      const loaded = useRequest('session-a', name).request?.name
      // Captured in an effect: the test reads what the committed render returned.
      useEffect(() => {
        currentName = loaded
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness name="alpha" />))
      await act(async () => root.render(<Harness name="beta" />))

      await act(async () => reads.get('beta')!.resolve(response('beta')))
      expect(currentName).toBe('beta')

      await act(async () => reads.get('alpha')!.resolve(response('alpha')))
      expect(currentName).toBe('beta')
      // Every read names the tab's own chat — the collection lives in that chat's project.
      expect(new Set(sessions)).toEqual(new Set(['session-a']))
    } finally {
      await act(async () => root.unmount())
      restApi.get = originalGet
    }
  })
})
