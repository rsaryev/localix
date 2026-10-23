/**
 * Curated Redis command reference for the kv console's verb autocomplete — a common,
 * cross-type subset (not the full ~240-command surface) with one-line summaries + a syntax
 * hint. Pure data + matcher so it's trivially testable and reusable.
 */
export interface RedisCommandInfo {
  /** Command verb, uppercase. */
  name: string
  /** Argument syntax hint (shown as detail). */
  syntax: string
  /** One-line description. */
  summary: string
}

export const REDIS_COMMANDS: RedisCommandInfo[] = [
  { name: 'GET', syntax: 'GET key', summary: 'Get a string value' },
  { name: 'SET', syntax: 'SET key value [EX s]', summary: 'Set a string value' },
  { name: 'SETEX', syntax: 'SETEX key seconds value', summary: 'Set with an expiry' },
  { name: 'SETNX', syntax: 'SETNX key value', summary: 'Set only if the key is absent' },
  { name: 'APPEND', syntax: 'APPEND key value', summary: 'Append to a string' },
  { name: 'INCR', syntax: 'INCR key', summary: 'Increment an integer' },
  { name: 'DECR', syntax: 'DECR key', summary: 'Decrement an integer' },
  { name: 'INCRBY', syntax: 'INCRBY key n', summary: 'Increment by n' },
  { name: 'MGET', syntax: 'MGET key [key …]', summary: 'Get several string values' },
  { name: 'MSET', syntax: 'MSET key value [key value …]', summary: 'Set several strings' },
  { name: 'DEL', syntax: 'DEL key [key …]', summary: 'Delete keys' },
  { name: 'UNLINK', syntax: 'UNLINK key [key …]', summary: 'Delete keys asynchronously' },
  { name: 'EXISTS', syntax: 'EXISTS key [key …]', summary: 'Check if keys exist' },
  { name: 'EXPIRE', syntax: 'EXPIRE key seconds', summary: 'Set a key TTL' },
  { name: 'TTL', syntax: 'TTL key', summary: 'Time to live, in seconds' },
  { name: 'PERSIST', syntax: 'PERSIST key', summary: 'Remove a key TTL' },
  { name: 'RENAME', syntax: 'RENAME key newkey', summary: 'Rename a key' },
  { name: 'TYPE', syntax: 'TYPE key', summary: "A key's data type" },
  { name: 'KEYS', syntax: 'KEYS pattern', summary: 'Find keys by glob (avoid in prod)' },
  {
    name: 'SCAN',
    syntax: 'SCAN cursor [MATCH p] [COUNT n]',
    summary: 'Incrementally iterate keys',
  },
  { name: 'DBSIZE', syntax: 'DBSIZE', summary: 'Number of keys' },
  { name: 'HGET', syntax: 'HGET key field', summary: 'Get a hash field' },
  { name: 'HSET', syntax: 'HSET key field value [field value …]', summary: 'Set hash fields' },
  { name: 'HGETALL', syntax: 'HGETALL key', summary: 'Get all hash fields + values' },
  { name: 'HDEL', syntax: 'HDEL key field [field …]', summary: 'Delete hash fields' },
  { name: 'HKEYS', syntax: 'HKEYS key', summary: 'All hash field names' },
  { name: 'LPUSH', syntax: 'LPUSH key value [value …]', summary: 'Prepend to a list' },
  { name: 'RPUSH', syntax: 'RPUSH key value [value …]', summary: 'Append to a list' },
  { name: 'LRANGE', syntax: 'LRANGE key start stop', summary: 'A range of list elements' },
  { name: 'LLEN', syntax: 'LLEN key', summary: 'List length' },
  { name: 'LPOP', syntax: 'LPOP key [count]', summary: 'Pop from the head of a list' },
  { name: 'SADD', syntax: 'SADD key member [member …]', summary: 'Add set members' },
  { name: 'SMEMBERS', syntax: 'SMEMBERS key', summary: 'All set members' },
  { name: 'SREM', syntax: 'SREM key member [member …]', summary: 'Remove set members' },
  { name: 'SCARD', syntax: 'SCARD key', summary: 'Set cardinality' },
  {
    name: 'ZADD',
    syntax: 'ZADD key score member [score member …]',
    summary: 'Add sorted-set members',
  },
  {
    name: 'ZRANGE',
    syntax: 'ZRANGE key start stop [WITHSCORES]',
    summary: 'A range of a sorted set',
  },
  { name: 'ZSCORE', syntax: 'ZSCORE key member', summary: "A member's score" },
  { name: 'XADD', syntax: 'XADD key * field value [field value …]', summary: 'Append to a stream' },
  { name: 'XRANGE', syntax: 'XRANGE key start end', summary: 'A range of stream entries' },
  { name: 'XLEN', syntax: 'XLEN key', summary: 'Stream length' },
  { name: 'FLUSHDB', syntax: 'FLUSHDB', summary: 'Remove all keys in the current DB' },
  { name: 'INFO', syntax: 'INFO [section]', summary: 'Server info + stats' },
  { name: 'PING', syntax: 'PING', summary: 'Liveness check' },
]

/**
 * Commands whose verb starts with `prefix` (case-insensitive), best-match first (exact, then
 * prefix), capped. An empty prefix returns []; a prefix that already has a trailing space (the
 * verb is complete + args are being typed) also returns [] — completion is verb-only.
 */
export function matchRedisCommands(prefix: string, limit = 8): RedisCommandInfo[] {
  const p = prefix.trim().toUpperCase()
  if (!p || prefix.includes(' ')) return []
  const hits = REDIS_COMMANDS.filter((c) => c.name.startsWith(p))
  hits.sort((a, b) => (a.name === p ? -1 : b.name === p ? 1 : a.name.localeCompare(b.name)))
  return hits.slice(0, limit)
}
