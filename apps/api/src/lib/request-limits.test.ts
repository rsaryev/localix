/**
 * The request-body limit, and the runtime behaviour that makes it the ONLY enforcement point.
 *
 * The measurements below are the evidence for deleting the media route's own byte check: they run
 * a real `Bun.serve` and show that an oversized body never reaches a handler in the shape a
 * per-route check could act on, and that the 413 carries nothing a client could read.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatByteLimit } from './request-limits'

describe('the declared limit', () => {
  test('formats as a limit a person can act on', () => {
    expect(formatByteLimit()).toBe('128 MB')
    expect(formatByteLimit(1024 * 1024)).toBe('1 MB')
    // A dropped file's size is arbitrary, so the message must not print 17 decimals.
    expect(formatByteLimit(1_500_000)).toBe('1.4 MB')
    expect(formatByteLimit(0)).toBe('0 MB')
  })
})

/** Serve `handler` with a tiny cap and return what the client and the handler each observed. */
async function probe(
  body: BodyInit,
  init: RequestInit = {},
): Promise<{ status: number; text: string; contentType: string | null; handlerOutcome: string }> {
  let handlerOutcome = 'handler not reached'
  const server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024,
    async fetch(req) {
      try {
        const buf = new Uint8Array(await req.arrayBuffer())
        handlerOutcome = `read ${buf.byteLength} bytes`
        return Response.json({ ok: true })
      } catch (error) {
        handlerOutcome = `arrayBuffer threw: ${error instanceof Error ? error.message : String(error)}`
        throw error
      }
    },
  })
  try {
    const res = await fetch(`http://localhost:${server.port}/`, { method: 'POST', body, ...init })
    return {
      status: res.status,
      text: await res.text(),
      contentType: res.headers.get('content-type'),
      handlerOutcome,
    }
  } finally {
    await server.stop(true)
  }
}

describe('why a per-route byte check cannot be the enforcement point', () => {
  test('a Content-Length body over the cap never reaches the handler', async () => {
    const result = await probe(new Uint8Array(4096))
    expect(result.status).toBe(413)
    // This is what makes a `if (buf.byteLength > CAP)` check in a route dead code.
    expect(result.handlerOutcome).toBe('handler not reached')
  })

  test('the 413 carries no body and no content-type, so no server message can reach the client', async () => {
    const result = await probe(new Uint8Array(4096))
    expect(result.text).toBe('')
    expect(result.contentType).toBeNull()
  })

  test('a CHUNKED body over the cap reaches the handler but its bytes never arrive', async () => {
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 8; i++) controller.enqueue(new Uint8Array(512))
        controller.close()
      },
    })
    const result = await probe(stream, { duplex: 'half' } as RequestInit)
    // The handler IS entered here — and a route-level size check still cannot help, because the
    // read itself fails and Bun has already committed the 413.
    expect(result.handlerOutcome).toContain('arrayBuffer threw')
    expect(result.handlerOutcome).toContain('maxRequestBodySize')
    expect(result.status).toBe(413)
  })

  test('a body under the cap is delivered normally', async () => {
    // Without this the three checks above would also pass on a server that rejects everything.
    const result = await probe(new Uint8Array(512))
    expect(result.status).toBe(200)
    expect(result.handlerOutcome).toBe('read 512 bytes')
  })
})

describe('the limit is actually installed on the server', () => {
  // Structural, because omitting `maxRequestBodySize` is invisible: the server starts, serves every
  // normal request, and only differs at the boundary — which is how the default came to be the
  // undocumented contract in the first place.
  const source = readFileSync(join(import.meta.dir, '..', 'index.ts'), 'utf8')

  test('Bun.serve is configured with the declared constant', () => {
    expect(source).toContain('maxRequestBodySize: MAX_REQUEST_BODY_BYTES')
  })

  test('and imports it rather than repeating the number', () => {
    expect(source).toContain("from './lib/request-limits'")
    // A literal here would drift from the constant the UI imports for its message.
    expect(source).not.toContain('maxRequestBodySize: 1')
  })
})
