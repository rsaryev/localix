import type { HttpClient, HttpResponse } from '@rsaryev/llx-plugin'

/**
 * The kit's `HttpClient` over a `fetch` (the host's, or a test's stub). The body is read as a
 * stream and cut at `maxBytes`, so a body far over the ceiling is never held whole; a cut text
 * body drops the half character at its end. A failed request is a `PortFailure`, never a throw.
 */

const lowerCased = (response: Response): Record<string, string> =>
  Object.fromEntries([...response.headers].map(([name, value]) => [name.toLowerCase(), value]))

async function readUpTo(
  response: Response,
  maxBytes: number | undefined,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader()
  if (!reader) return { bytes: new Uint8Array(), truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return { bytes: new Uint8Array(Buffer.concat(chunks)), truncated: false }
    chunks.push(value)
    total += value.byteLength
    if (maxBytes !== undefined && total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { bytes: new Uint8Array(Buffer.concat(chunks).subarray(0, maxBytes)), truncated: true }
    }
  }
}

export function fetchHttpClient(fetchImpl: typeof fetch = fetch): HttpClient {
  return {
    async request(request) {
      const timeout = request.timeoutMs ? AbortSignal.timeout(request.timeoutMs) : undefined
      const signal = timeout ? AbortSignal.any([request.signal, timeout]) : request.signal
      try {
        const response = await fetchImpl(request.url, {
          method: request.method,
          headers: { ...request.headers },
          ...(request.body === undefined ? {} : { body: request.body }),
          redirect: request.redirect ?? 'follow',
          signal,
        })
        const { bytes, truncated } = await readUpTo(response, request.maxBytes)
        const text =
          request.as === 'bytes' ? '' : new TextDecoder().decode(bytes, { stream: truncated })
        const answer: HttpResponse = {
          status: response.status,
          headers: lowerCased(response),
          body: text,
          ...(request.as === 'bytes' ? { bytes } : {}),
          truncated,
        }
        return answer
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (request.signal.aborted) return { failure: 'aborted', message }
        if (timeout?.aborted) return { failure: 'timeout', message }
        return { failure: 'connection', message }
      }
    },
  }
}
