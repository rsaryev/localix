/**
 * Pure, dependency-free Redis helpers — the testable kernel of the Redis driver (which is a
 * thin wrapper over Bun's built-in `RedisClient` around these). Kept separate from the I/O so the tricky bits (command
 * tokenization + shaping a heterogeneous Redis reply into the SQL-shaped {@link DbResultSet}
 * the console grid already renders) are unit-tested without a live server.
 *
 * A Redis command console reuses the SAME result grid as SQL: we normalize every reply into
 * columns + rows. Scalars become a one-cell `value`; flat arrays become N `value` rows; a
 * map (HGETALL) becomes `field`/`value` pairs; nested/complex elements are JSON-encoded.
 */
import type { DbResultSet } from './port'
import { exactJsonInteger, stringifyJsonExact } from '../../shared/exact-json'

export type RedisSend = (command: string, args: string[]) => Promise<unknown>

/** Hard network-round-trip bound for one cursor walk. COUNT is only a hint and a valid
 * SCAN page may be empty, so an element cap alone cannot bound execution. */
export const REDIS_SCAN_MAX_ROUNDS = 1_000

/**
 * Split a Redis command line into argv, honouring single/double quotes (so
 * `SET greeting "hello world"` → `['SET', 'greeting', 'hello world']`). A backslash inside a
 * quoted span escapes the next character. Unterminated quotes are rejected rather than
 * executing a different argument than the user entered.
 */
export function parseRedisCommand(line: string): string[] {
  const args: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let has = false // whether the current token has started (so `""` yields an empty arg)
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quote) {
      if (ch === '\\' && i + 1 < line.length) {
        cur += line[++i]
      } else if (ch === quote) {
        quote = null
      } else {
        cur += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      has = true
    } else if (ch === ' ' || ch === '\t') {
      if (has) {
        args.push(cur)
        cur = ''
        has = false
      }
    } else {
      cur += ch
      has = true
    }
  }
  if (quote) throw new Error(`Unterminated ${quote} quote in Redis command.`)
  if (has) args.push(cur)
  return args
}

/** Preserve ordinary UTF-8 Redis strings as text while keeping arbitrary bytes distinguishable
 * end-to-end. Control bytes are treated as binary even when they happen to be valid UTF-8. */
export function decodeRedisBytes(bytes: Uint8Array | null): string | Buffer | null {
  if (bytes === null) return null
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    let hasControlByte = false
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
        hasControlByte = true
        break
      }
    }
    if (!hasControlByte) return text
  } catch {
    // Invalid UTF-8 is a binary value, not replacement-character text.
  }
  return Buffer.from(bytes)
}

/** Is this a JS scalar we can render directly in a single cell? */
function isScalar(v: unknown): boolean {
  return (
    v === null || v === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof v)
  )
}

/** Render one reply element into a cell value (scalars as-is, complex as compact JSON). */
function cell(v: unknown): unknown {
  if (typeof v === 'bigint') return exactJsonInteger(v)
  if (v instanceof Uint8Array) return Buffer.from(v)
  if (isScalar(v)) return v ?? null
  try {
    return stringifyJsonExact(v)
  } catch {
    return String(v)
  }
}

/**
 * Normalize a Redis reply into the tabular {@link DbResultSet} the console grid renders.
 * `durationMs` is supplied by the caller (the driver times the round-trip).
 */
export function shapeRedisReply(reply: unknown, durationMs = 0): DbResultSet {
  // nil → one NULL cell (so the user sees "(nil)" rather than an empty grid).
  if (reply === null || reply === undefined) {
    return { columns: [{ name: 'value' }], rows: [[null]], durationMs }
  }
  if (Array.isArray(reply)) {
    return {
      columns: [{ name: 'value' }],
      rows: reply.map((v) => [cell(v)]),
      durationMs,
    }
  }
  // A plain object (e.g. a client's shaped HGETALL / CONFIG GET reply) → field/value pairs.
  if (typeof reply === 'object' && !(reply instanceof Uint8Array)) {
    return {
      columns: [{ name: 'field' }, { name: 'value' }],
      rows: Object.entries(reply as Record<string, unknown>).map(([k, v]) => [k, cell(v)]),
      durationMs,
    }
  }
  // Scalar (OK / integer / string / Buffer-as-string).
  return { columns: [{ name: 'value' }], rows: [[cell(reply)]], durationMs }
}

/** Turn alternating Redis values (field/value or member/score) into a two-column page. */
export function shapeRedisPairs(
  values: unknown[],
  columns: readonly [string, string],
  durationMs = 0,
): DbResultSet {
  if (values.length % 2 !== 0) {
    throw new Error(`Redis pair response contained ${values.length} values.`)
  }
  return {
    columns: columns.map((name) => ({ name })),
    rows: Array.from({ length: Math.floor(values.length / 2) }, (_, index) => [
      cell(values[index * 2]),
      cell(values[index * 2 + 1]),
    ]),
    durationMs,
  }
}

function scanIdentity(value: unknown): string {
  if (typeof value === 'string') return `string:${value}`
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return `${typeof value}:${String(value)}`
  }
  try {
    return `json:${stringifyJsonExact(value)}`
  } catch {
    return `${typeof value}:${String(value)}`
  }
}

/** Numeric paging over cursor-based HSCAN/SSCAN. Redis COUNT is only a hint, so keep
 * following cursors until the requested offset+limit is actually available or the scan
 * completes. Redis explicitly permits duplicate elements during a full iteration; count only
 * unique hash fields/set members so duplicates cannot shift an offset page. */
export async function scanRedisPage(
  send: RedisSend,
  command: 'HSCAN' | 'SSCAN',
  key: string,
  offset: number,
  limit: number,
): Promise<unknown[]> {
  const stride = command === 'HSCAN' ? 2 : 1
  const wanted = (offset + limit) * stride
  const values: unknown[] = []
  const seenCursors = new Set<string>()
  const seenEntries = new Set<string>()
  let cursor = '0'
  let rounds = 0
  do {
    if (rounds >= REDIS_SCAN_MAX_ROUNDS) {
      throw new Error(`Redis ${command} exceeded the ${REDIS_SCAN_MAX_ROUNDS}-round browse limit.`)
    }
    rounds += 1
    const reply = await send(command, [
      key,
      cursor,
      'COUNT',
      String(Math.min(500, Math.max(20, wanted - values.length))),
    ])
    if (!Array.isArray(reply) || reply.length < 2 || !Array.isArray(reply[1])) {
      throw new Error(`Redis ${command} returned an invalid cursor response.`)
    }
    const next = String(reply[0])
    const batch = reply[1]
    if (command === 'HSCAN') {
      if (batch.length % 2 !== 0) {
        throw new Error(`Redis HSCAN returned an incomplete field/value pair.`)
      }
      for (let index = 0; index < batch.length; index += 2) {
        const identity = scanIdentity(batch[index])
        if (seenEntries.has(identity)) continue
        seenEntries.add(identity)
        values.push(batch[index], batch[index + 1])
      }
    } else {
      for (const member of batch) {
        const identity = scanIdentity(member)
        if (seenEntries.has(identity)) continue
        seenEntries.add(identity)
        values.push(member)
      }
    }
    if (next === '0' || seenCursors.has(next)) break
    seenCursors.add(next)
    cursor = next
  } while (values.length < wanted)
  return values.slice(offset * stride, (offset + limit) * stride)
}

/** Abbreviate a Redis `TYPE` reply into a compact sidebar badge (`string`→`str`, else the type;
 *  `none`/unknown → ''). Pure so it's shared by the driver + trivially tested. */
export function abbreviateRedisType(type: string): string {
  switch (type) {
    case 'string':
      return 'str'
    case 'list':
    case 'set':
    case 'zset':
    case 'hash':
    case 'stream':
      return type
    default:
      return ''
  }
}
