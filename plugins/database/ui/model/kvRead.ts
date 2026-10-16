/**
 * Redis key browsing helpers (pure). Given a key's TYPE, pick the read command that shows
 * its whole value in the console grid — so clicking a key in the keyspace tree runs a
 * type-appropriate read instead of a SQL `SELECT` (which Redis can't run).
 */

/** Redis `TYPE` replies (plus a defensive fallback). */
export type RedisType = 'string' | 'list' | 'set' | 'zset' | 'hash' | 'stream' | 'none'

/**
 * Pure read commands that never add/remove a key — the keyspace tree can't change after them.
 * Anything NOT in this set is treated as possibly-mutating (see {@link redisTouchesKeyspace}),
 * which is the safe default (an unknown command refreshes rather than silently going stale).
 */
const REDIS_READ_COMMANDS = new Set([
  'GET',
  'MGET',
  'GETRANGE',
  'STRLEN',
  'KEYS',
  'SCAN',
  'TYPE',
  'TTL',
  'PTTL',
  'EXISTS',
  'DBSIZE',
  'RANDOMKEY',
  'OBJECT',
  'DUMP',
  'MEMORY',
  'HGET',
  'HGETALL',
  'HKEYS',
  'HVALS',
  'HLEN',
  'HMGET',
  'HEXISTS',
  'HSCAN',
  'HSTRLEN',
  'LRANGE',
  'LLEN',
  'LINDEX',
  'LPOS',
  'SMEMBERS',
  'SCARD',
  'SISMEMBER',
  'SMISMEMBER',
  'SSCAN',
  'SRANDMEMBER',
  'ZRANGE',
  'ZRANGEBYSCORE',
  'ZRANGEBYLEX',
  'ZCARD',
  'ZSCORE',
  'ZMSCORE',
  'ZRANK',
  'ZREVRANK',
  'ZCOUNT',
  'ZSCAN',
  'XRANGE',
  'XREVRANGE',
  'XLEN',
  'XREAD',
  'GETBIT',
  'BITCOUNT',
  'GEODIST',
  'GEOPOS',
  'PFCOUNT',
  'PING',
  'INFO',
  'ECHO',
  'TIME',
  'COMMAND',
  'CONFIG',
  'CLIENT',
  'LATENCY',
  'SUBSCRIBE',
])

/**
 * Whether a Redis command may add or remove a key (so the keyspace tree should refresh after
 * it) — true for anything whose verb isn't a known pure read. Empty input → false.
 */
export function redisTouchesKeyspace(command: string): boolean {
  const verb = command.trim().split(/\s+/)[0]?.toUpperCase()
  if (!verb) return false
  return !REDIS_READ_COMMANDS.has(verb)
}

/** Double-quote + escape a key so it survives command tokenization (keys may hold spaces). */
export function quoteRedisKey(key: string): string {
  return `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Normalize a raw `TYPE` reply (case/whitespace) into a {@link RedisType}. */
export function parseRedisType(reply: unknown): RedisType {
  const t = (typeof reply === 'string' ? reply : '').trim().toLowerCase()
  if (
    t === 'string' ||
    t === 'list' ||
    t === 'set' ||
    t === 'zset' ||
    t === 'hash' ||
    t === 'stream'
  )
    return t
  return 'none'
}

/**
 * The command that reads a key's full value for display, by its Redis type. Whole-collection
 * reads are bounded implicitly by the keyspace/UX (the grid paginates); streams use XRANGE.
 */
export function readCommandForType(type: RedisType, key: string): string {
  const k = quoteRedisKey(key)
  switch (type) {
    case 'list':
      return `LRANGE ${k} 0 -1`
    case 'set':
      return `SMEMBERS ${k}`
    case 'zset':
      return `ZRANGE ${k} 0 -1 WITHSCORES`
    case 'hash':
      return `HGETALL ${k}`
    case 'stream':
      return `XRANGE ${k} - +`
    case 'string':
    case 'none':
      break
  }
  return `GET ${k}`
}
