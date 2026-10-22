import { expect, test } from 'bun:test'
import { fetchUrl, stubFetch } from '../../../testing/fetch-stub'
import { modFetch } from './http-api'

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

/** A fetch that answers each URL from `routes` and records every request it was given. */
function recordingFetch(routes: Record<string, () => Response>) {
  const seen: Seen[] = []
  const fetcher = stubFetch(async (input, init) => {
    const url = fetchUrl(input)
    seen.push({
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    const route = routes[url]
    if (!route) throw new Error(`no route for ${url}`)
    return route()
  })
  return { fetcher, seen }
}

const redirect = (status: number, location: string) =>
  new Response(null, { status, headers: { location } })

test('only http and https URLs are fetched', async () => {
  const { fetcher, seen } = recordingFetch({})
  for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'data:text/plain,hi'])
    await expect(modFetch(url, {}, fetcher)).rejects.toThrow(/only http and https/)
  expect(seen).toEqual([])
})

test('a redirect to a non-http scheme is refused', async () => {
  const { fetcher, seen } = recordingFetch({
    'https://a.example/': () => redirect(302, 'file:///etc/passwd'),
  })
  await expect(modFetch('https://a.example/', {}, fetcher)).rejects.toThrow(/only http and https/)
  expect(seen.map((s) => s.url)).toEqual(['https://a.example/'])
})

test('a cross-origin redirect keeps only the harmless headers', async () => {
  const { fetcher, seen } = recordingFetch({
    'https://a.example/start': () => redirect(307, '/same'),
    'https://a.example/same': () => redirect(307, 'https://b.example/end'),
    'https://b.example/end': () => new Response('done'),
  })
  const headers = {
    Authorization: 'Bearer secret',
    Cookie: 'session=1',
    'X-Api-Key': 'key',
    Accept: 'application/json',
    'Accept-Language': 'en',
    'Content-Type': 'text/plain',
    'User-Agent': 'mod',
  }
  const result = await modFetch(
    'https://a.example/start',
    { method: 'PUT', headers, body: 'payload' },
    fetcher,
  )
  expect(result.text).toBe('done')
  expect(seen[1]?.headers).toEqual(headers)
  expect(seen[2]).toEqual({
    url: 'https://b.example/end',
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
      'Content-Type': 'text/plain',
      'User-Agent': 'mod',
    },
    body: 'payload',
  })
})

test('a 303, or a 301/302 after a POST, goes on as a GET without its body', async () => {
  for (const [status, method, expected] of [
    [303, 'PUT', 'GET'],
    [302, 'POST', 'GET'],
    [301, 'POST', 'GET'],
    [302, 'PUT', 'PUT'],
    [303, 'HEAD', 'HEAD'],
  ] as const) {
    const { fetcher, seen } = recordingFetch({
      'https://a.example/form': () => redirect(status, '/result'),
      'https://a.example/result': () => new Response('ok'),
    })
    await modFetch(
      'https://a.example/form',
      { method, headers: { 'Content-Type': 'text/plain', 'X-Trace': '1' }, body: 'data' },
      fetcher,
    )
    const final = seen[1]
    expect(final?.method).toBe(expected)
    if (expected === 'GET') {
      expect(final?.body).toBeUndefined()
      expect(final?.headers).toEqual({ 'X-Trace': '1' })
    } else {
      expect(final?.body).toBe('data')
    }
  }
})

test('a body with no length is read up to 4 MiB and the rest is never pulled', async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(0x61)
  let pulled = 0
  let cancelled = false
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= 64 * chunk.byteLength) return controller.close()
        pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  const { fetcher } = recordingFetch({ 'https://a.example/big': () => new Response(body) })
  const result = await modFetch('https://a.example/big', {}, fetcher)
  expect(result.text.length).toBe(4 * 1024 * 1024)
  expect(pulled).toBeLessThanOrEqual(5 * 1024 * 1024)
  expect(cancelled).toBe(true)
})

test('a short body is read whole, and a character cut at the limit is dropped', async () => {
  const { fetcher } = recordingFetch({ 'https://a.example/': () => new Response('héllo') })
  expect((await modFetch('https://a.example/', {}, fetcher)).text).toBe('héllo')
  const cut = new Uint8Array(4 * 1024 * 1024 + 1).fill(0x61)
  cut.set([0xc3, 0xa9], 4 * 1024 * 1024 - 1)
  const edge = recordingFetch({ 'https://a.example/': () => new Response(cut) })
  const text = (await modFetch('https://a.example/', {}, edge.fetcher)).text
  expect(text.length).toBe(4 * 1024 * 1024 - 1)
  expect(text.endsWith('a')).toBe(true)
})

test('the size limit spares a HEAD by the method of the final request', async () => {
  const big = () =>
    new Response(null, { status: 200, headers: { 'content-length': String(5 * 1024 * 1024) } })
  const head = recordingFetch({
    'https://a.example/': () => redirect(303, '/big'),
    'https://a.example/big': big,
  })
  expect((await modFetch('https://a.example/', { method: 'HEAD' }, head.fetcher)).status).toBe(200)
  const post = recordingFetch({
    'https://a.example/': () => redirect(303, '/big'),
    'https://a.example/big': big,
  })
  await expect(
    modFetch('https://a.example/', { method: 'POST', body: 'x' }, post.fetcher),
  ).rejects.toThrow(/limit/)
})
