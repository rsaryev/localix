import { describe, expect, test } from 'bun:test'
import {
  MULTIPLEXED_CONTENT_TYPE,
  demultiplexDockerLogs,
  isMultiplexedStream,
  readDockerLogs,
} from './log-stream'

/** Build one Docker log frame: stream id, three zero bytes, big-endian length, payload. */
function frame(stream: 1 | 2, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text)
  const bytes = new Uint8Array(8 + payload.length)
  bytes[0] = stream
  bytes[4] = (payload.length >>> 24) & 0xff
  bytes[5] = (payload.length >>> 16) & 0xff
  bytes[6] = (payload.length >>> 8) & 0xff
  bytes[7] = payload.length & 0xff
  bytes.set(payload, 8)
  return bytes
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

describe('isMultiplexedStream', () => {
  test('recognises the daemon s content type, with or without parameters', () => {
    expect(isMultiplexedStream(MULTIPLEXED_CONTENT_TYPE)).toBe(true)
    expect(isMultiplexedStream('application/vnd.docker.multiplexed-stream; charset=utf-8')).toBe(
      true,
    )
    expect(isMultiplexedStream('Application/VND.Docker.Multiplexed-Stream')).toBe(true)
  })

  test('a TTY container s raw stream is not framed', () => {
    expect(isMultiplexedStream('application/vnd.docker.raw-stream')).toBe(false)
    expect(isMultiplexedStream('text/plain')).toBe(false)
    expect(isMultiplexedStream(null)).toBe(false)
  })
})

describe('demultiplexDockerLogs', () => {
  test('payloads come out clean, with no header bytes in the text', () => {
    // The defect this exists to prevent: read as text, the header shows up as control
    // characters glued to the front of the line.
    const bytes = frame(1, '2026-07-28T10:42:50.883688086Z hello\n')
    expect(demultiplexDockerLogs(bytes).combined).toBe('2026-07-28T10:42:50.883688086Z hello\n')
  })

  test('stdout and stderr interleave in ARRIVAL order', () => {
    // The order is the information: the error belongs right after the request that caused it.
    const bytes = concat(frame(1, 'GET /x\n'), frame(2, 'boom\n'), frame(1, '500\n'))
    const result = demultiplexDockerLogs(bytes)
    expect(result.combined).toBe('GET /x\nboom\n500\n')
    expect(result.hasStderr).toBe(true)
  })

  test('a stdout-only stream reports no stderr', () => {
    expect(demultiplexDockerLogs(frame(1, 'fine\n')).hasStderr).toBe(false)
  })

  test('a payload longer than 255 bytes decodes — the length is a 32-bit big-endian int', () => {
    // A one-byte length would have worked for every short test line and broken on the first
    // real log line; the observed frame was 0x00000145 = 325 bytes.
    const long = 'x'.repeat(325)
    expect(demultiplexDockerLogs(frame(1, long)).combined).toBe(long)
  })

  test('multi-byte UTF-8 survives frame boundaries', () => {
    const bytes = concat(frame(1, 'olá '), frame(1, '日本語\n'))
    expect(demultiplexDockerLogs(bytes).combined).toBe('olá 日本語\n')
  })

  test('a truncated trailing frame is dropped, not decoded as garbage', () => {
    // A `tail` read can cut mid-frame; losing a partial line beats rendering binary.
    const complete = frame(1, 'first\n')
    const cut = frame(1, 'second\n').subarray(0, 10)
    expect(demultiplexDockerLogs(concat(complete, cut)).combined).toBe('first\n')
  })

  test('a header-only tail is dropped', () => {
    const bytes = concat(frame(1, 'first\n'), new Uint8Array([1, 0, 0, 0]))
    expect(demultiplexDockerLogs(bytes).combined).toBe('first\n')
  })

  test('losing frame alignment stops decoding instead of emitting noise', () => {
    // Byte 0 must be 1 or 2. Anything else means we are no longer at a frame boundary, and
    // continuing would spray the rest of the stream into the log pane.
    const bytes = concat(frame(1, 'good\n'), new Uint8Array([9, 0, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]))
    expect(demultiplexDockerLogs(bytes).combined).toBe('good\n')
  })

  test('an empty body is empty output', () => {
    expect(demultiplexDockerLogs(new Uint8Array())).toEqual({ combined: '', hasStderr: false })
  })
})

describe('readDockerLogs', () => {
  test('a framed response is de-multiplexed', async () => {
    const bytes = concat(frame(1, 'out\n'), frame(2, 'err\n'))
    const response = new Response(Uint8Array.from(bytes).buffer, {
      headers: { 'content-type': MULTIPLEXED_CONTENT_TYPE },
    })
    expect(await readDockerLogs(response)).toBe('out\nerr\n')
  })

  test('a TTY container s raw body passes through untouched', async () => {
    const response = new Response('plain log line\n', {
      headers: { 'content-type': 'application/vnd.docker.raw-stream' },
    })
    expect(await readDockerLogs(response)).toBe('plain log line\n')
  })
})
