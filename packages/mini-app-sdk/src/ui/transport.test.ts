import { afterEach, describe, expect, test } from 'bun:test'

import {
  assertMiniAppResponse,
  bindMiniAppUiTransport,
  cleanMiniAppQuery,
  miniAppApiFetch,
  miniAppApiUrl,
  postMiniAppJson,
  unwrapMiniAppResponse,
} from './transport'

let unbind: (() => void) | undefined
afterEach(() => unbind?.())

describe('plugin UI transport boundary', () => {
  test('delegates validated plugin routes to the host', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    unbind = bindMiniAppUiTransport({
      request: async (path, init) => {
        calls.push({ path, init })
        return Response.json({ ok: true })
      },
      url: (path) => `https://localix.test${path}`,
    })

    await postMiniAppJson('/rpc/example/items', { id: 7 })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/rpc/example/items')
    expect(calls[0]?.init).toMatchObject({ method: 'POST' })
    expect(miniAppApiUrl('/rpc/example/export')).toBe('https://localix.test/rpc/example/export')
  })

  test('rejects absolute, protocol-relative, and host-internal routes', () => {
    unbind = bindMiniAppUiTransport({
      request: async () => new Response(),
      url: (path) => path,
    })

    expect(() => miniAppApiFetch('https://example.com/rpc/plugin')).toThrow()
    expect(() => miniAppApiFetch('//example.com/rpc/plugin')).toThrow()
    expect(() => miniAppApiFetch('/internal/admin')).toThrow()
  })

  test('parses the shared error envelope and cleans query values', async () => {
    const response = Response.json(
      { error: { code: 'missing', message: 'Not found', detail: 'no row with id 7' } },
      { status: 404 },
    )
    const error = await unwrapMiniAppResponse(response).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      message: 'Not found',
      status: 404,
      code: 'missing',
      detail: 'no row with id 7',
    })
    expect(cleanMiniAppQuery({ page: 2, q: '', optional: undefined })).toEqual({ page: '2' })
  })

  // The defect this fixes: routes answering the FLAT body were read as if they had said nothing,
  // so both the sentence and the raw text went over the wire and were thrown away.
  test('reads the flat plugin body too, sentence and raw text both', async () => {
    const response = Response.json(
      {
        error: 'That spreadsheet could not be opened.',
        code: 'not_tabular',
        detail: 'invalid zip data',
      },
      { status: 400 },
    )
    const error = await unwrapMiniAppResponse(response).catch((reason: unknown) => reason)
    expect(error).toMatchObject({
      message: 'That spreadsheet could not be opened.',
      status: 400,
      code: 'not_tabular',
      detail: 'invalid zip data',
    })
  })

  test('an unreadable body still yields a sentence, never a status line', async () => {
    // It used to answer `Request failed with status 502`, which names neither what failed nor what
    // to do, and worded the same failure differently from the host transport one layer up.
    const error = await assertMiniAppResponse(new Response('<html>', { status: 502 })).catch(
      (reason: unknown) => reason,
    )
    expect(error).toMatchObject({ message: 'The server could not complete this.', code: null })
    expect((error as { detail?: string }).detail).toBeUndefined()
  })
})
