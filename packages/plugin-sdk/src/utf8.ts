/**
 * UTF-8 byte measurement — web-standard only, no Node globals.
 *
 * `Buffer.byteLength` is the obvious way to count UTF-8 bytes in Bun/Node, but the
 * bare `Buffer` identifier makes bundlers inject a ~27KB polyfill into any browser
 * bundle that reaches this graph (`resource-refs` is deliberately browser-safe and
 * is imported by the UI composer through `@localixai/api/context-refs`). `TextEncoder`
 * is a WHATWG global present in browsers, Bun, Node 18+ and edge runtimes, so it
 * measures the same bytes with zero polyfill and zero dependencies.
 *
 * Same contract as `Buffer.byteLength(value, 'utf8')` — this counts UTF-8 bytes only.
 * It is NOT a substitute for `Buffer.byteLength(value, 'base64')` or any other
 * encoding, which return different numbers.
 */

const sharedTextEncoder = new TextEncoder()

/** UTF-8 byte length of a string — identical to `Buffer.byteLength(value, 'utf8')`. */
export function utf8ByteLength(value: string): number {
  return sharedTextEncoder.encode(value).byteLength
}
