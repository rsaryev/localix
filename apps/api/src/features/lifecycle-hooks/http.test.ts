import { afterEach, describe, expect, test } from 'bun:test'
import { runHookHttp, type HookHttpOptions } from './http'

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(async () => {
  await server?.stop(true)
  server = undefined
})
function endpoint(handler: (request: Request) => Response | Promise<Response>): string {
  server = Bun.serve({ port: 0, fetch: handler })
  return `http://localhost:${server.port}`
}
const options = (url: string, extra: Partial<HookHttpOptions> = {}): HookHttpOptions => ({
  url,
  headers: {},
  input: '',
  timeoutMs: 1000,
  maxOutputBytes: 1024,
  ...extra,
})

describe('native hook HTTP transport', () => {
  test('a protocol can ignore an error body without waiting for the endpoint to close it', async () => {
    const url = endpoint(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('error'))
            },
          }),
          { status: 503 },
        ),
    )
    expect(await runHookHttp(options(url, { readBody: (status) => status < 300 }))).toEqual({
      kind: 'response',
      status: 503,
      body: '',
      truncated: false,
    })
  })
  test('transports bytes and status without interpreting external hook fields', async () => {
    const url = endpoint(async (request) => {
      expect(request.method).toBe('POST')
      expect(request.headers.get('X-Input')).toBe('literal')
      expect(await request.text()).toBe('opaque input')
      return new Response('opaque response', { status: 403 })
    })
    expect(
      await runHookHttp(options(url, { headers: { 'X-Input': 'literal' }, input: 'opaque input' })),
    ).toEqual({ kind: 'response', status: 403, body: 'opaque response', truncated: false })
  })

  test('stops reading at the byte budget even when the endpoint never closes', async () => {
    const url = endpoint(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('éééé'))
            },
          }),
        ),
    )
    expect(await runHookHttp(options(url, { maxOutputBytes: 5 }))).toEqual({
      kind: 'response',
      status: 200,
      body: 'éé',
      truncated: true,
    })
  })

  test('the timeout covers reading the body, not only receiving response headers', async () => {
    const url = endpoint(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('x'))
            },
          }),
        ),
    )
    expect(await runHookHttp(options(url, { timeoutMs: 30 }))).toEqual({ kind: 'timeout' })
  })

  test('caller cancellation is distinct from a timeout', async () => {
    const controller = new AbortController()
    const url = endpoint(
      () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('x'))
            },
          }),
        ),
    )
    const pending = runHookHttp(options(url, { signal: controller.signal }))
    controller.abort()
    expect(await pending).toEqual({ kind: 'aborted' })
  })

  test('pre-cancelled calls never try to parse or fetch the endpoint', async () => {
    expect(await runHookHttp(options('invalid URL', { signal: AbortSignal.abort() }))).toEqual({
      kind: 'aborted',
    })
  })
})
