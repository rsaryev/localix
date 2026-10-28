import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { RequestInfo, RequestResponse } from '../../backend/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function request(url: string, auth: RequestInfo['spec']['auth'] = { type: 'none' }): RequestInfo {
  return {
    name: 'alpha',
    createdAt: 1,
    updatedAt: 1,
    spec: { url, method: 'GET', headers: [], query: [], auth },
  }
}

describe('request edit lifecycle', () => {
  test('valid JSON is formatted at save while invalid JSON remains verbatim', async () => {
    const { draftFrom, formatDraftForSave } = await import('./useRequestEdit')
    const base = {
      url: 'https://api.test',
      method: 'POST' as const,
      headers: [],
      query: [],
      body: { mimeType: 'application/json', text: '{"ready":true}' },
    }

    expect(formatDraftForSave(base).body?.text).toBe('{\n  "ready": true\n}')
    expect(
      formatDraftForSave({ ...base, body: { ...base.body, text: '{"ready":' } }).body?.text,
    ).toBe('{"ready":')
    expect(
      draftFrom({
        ...base,
        auth: { type: 'none' },
      }).body?.text,
    ).toBe('{\n  "ready": true\n}')
  })

  test('an auth-only reload does not erase an unsaved URL edit', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { useRequestEdit } = await import('./useRequestEdit')
    let state!: ReturnType<typeof useRequestEdit>

    function Harness({ value }: { value: RequestInfo }) {
      const edit = useRequestEdit('session-a', value, () => {})
      // Captured in an effect: the test reads what the committed render returned.
      useEffect(() => {
        state = edit
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness value={request('https://api.test/old')} />))
      await act(async () => state.patch({ url: 'https://api.test/draft' }))
      await act(async () =>
        root.render(
          <Harness value={request('https://api.test/old', { type: 'bearer', token: '••••••' })} />,
        ),
      )
      expect(state.draft?.url).toBe('https://api.test/draft')
      expect(state.dirty).toBe(true)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('a clean draft follows an external request update', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { useRequestEdit } = await import('./useRequestEdit')
    let state!: ReturnType<typeof useRequestEdit>
    function Harness({ value }: { value: RequestInfo }) {
      const edit = useRequestEdit('session-a', value, () => {})
      // Captured in an effect: the test reads what the committed render returned.
      useEffect(() => {
        state = edit
      })
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness value={request('https://api.test/one')} />))
      await act(async () => root.render(<Harness value={request('https://api.test/two')} />))
      expect(state.draft?.url).toBe('https://api.test/two')
      expect(state.dirty).toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })

  test('save adopts the server-normalized draft before reload', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { restApi } = await import('../restApi')
    const { useRequestEdit } = await import('./useRequestEdit')
    const original = restApi.update.bind(restApi)
    const initial = request('https://api.test/old')
    const savedIn: string[] = []
    restApi.update = async (sessionId): Promise<RequestResponse> => {
      savedIn.push(sessionId)
      return { request: request('https://api.test/normalized') }
    }
    let state!: ReturnType<typeof useRequestEdit>
    function Harness() {
      const edit = useRequestEdit('session-a', initial, () => {})
      // Captured in an effect: the test reads what the committed render returned.
      useEffect(() => {
        state = edit
      })
      return null
    }
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness />))
      await act(async () => state.patch({ url: 'https://api.test/input' }))
      await act(async () => void (await state.save()))
      expect(state.draft?.url).toBe('https://api.test/normalized')
      expect(state.dirty).toBe(false)
      // The save goes to the tab's chat, not to whichever one is on screen.
      expect(savedIn).toEqual(['session-a'])
    } finally {
      restApi.update = original
      await act(async () => root.unmount())
    }
  })
})
