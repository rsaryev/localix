import { describe, expect, test } from 'bun:test'
import type { HttpRequest } from '@rsaryev/llx-plugin'
import { fetchBody, fetchUrl, stubFetch } from '../../../../testing/fetch-stub'
import { fetchHttpClient } from './http-client'

const request = (extra: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'GET',
  url: 'http://127.0.0.1/x',
  headers: {},
  signal: new AbortController().signal,
  ...extra,
})

describe('the http client the kit asks for a request', () => {
  test('sends the method, headers and body, and answers with lower-cased headers', async () => {
    const seen: string[] = []
    const client = fetchHttpClient(
      stubFetch(async (input, init) => {
        seen.push(`${init?.method} ${fetchUrl(input)} ${fetchBody(init)}`)
        return new Response('ok', { status: 201, headers: { 'X-Thing': 'yes' } })
      }),
    )
    const answer = await client.request(request({ method: 'POST', body: '{"a":1}' }))
    expect(seen).toEqual(['POST http://127.0.0.1/x {"a":1}'])
    expect(answer).toMatchObject({ status: 201, body: 'ok', truncated: false })
    expect('headers' in answer && answer.headers['x-thing']).toBe('yes')
  })

  test('gives the raw bytes of an archive and cuts a body at its byte ceiling', async () => {
    const client = fetchHttpClient(
      stubFetch(async () => new Response(new Uint8Array([1, 2, 3, 4]))),
    )
    expect(await client.request(request({ as: 'bytes', maxBytes: 3 }))).toEqual({
      status: 200,
      headers: {},
      body: '',
      bytes: new Uint8Array([1, 2, 3]),
      truncated: true,
    })
  })

  test('does not leave half a character at a cut text body', async () => {
    const client = fetchHttpClient(stubFetch(async () => new Response('aé')))
    expect(await client.request(request({ maxBytes: 2 }))).toMatchObject({
      body: 'a',
      truncated: true,
    })
  })

  test('passes a redirect back as it is when the kit judges each hop', async () => {
    let mode: RequestRedirect | undefined
    const client = fetchHttpClient(
      stubFetch(async (_input, init) => {
        mode = init?.redirect
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/y' } })
      }),
    )
    const answer = await client.request(request({ redirect: 'manual' }))
    expect(mode).toBe('manual')
    expect(answer).toMatchObject({ status: 302, headers: { location: 'http://127.0.0.1/y' } })
  })

  test('reports a refused connection, an abort and a timeout as failures, never a throw', async () => {
    const refused = fetchHttpClient(stubFetch(() => Promise.reject(new Error('ECONNREFUSED'))))
    expect(await refused.request(request())).toEqual({
      failure: 'connection',
      message: 'ECONNREFUSED',
    })
    // A stub that answers only when its signal aborts, at once when it already has, as fetch does.
    const hangs = fetchHttpClient(
      stubFetch(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const stop = () => reject(new Error('stopped'))
            if (init?.signal?.aborted) stop()
            init?.signal?.addEventListener('abort', stop)
          }),
      ),
    )
    expect(await hangs.request(request({ signal: AbortSignal.abort() }))).toMatchObject({
      failure: 'aborted',
    })
    expect(await hangs.request(request({ timeoutMs: 1 }))).toMatchObject({ failure: 'timeout' })
  })
})
