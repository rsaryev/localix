/**
 * Pure Redis read/write classifier for the read-only connection guard-rail.
 *
 * DELIBERATELY NOT the same set as the UI's `kvRead.redisTouchesKeyspace`. That one
 * answers "can the keyspace change, i.e. must the key tree refresh?"; this one answers
 * "is this command DEFINITELY only reading?". The two genuinely differ, and conflating
 * them would open a hole rather than remove a duplicate:
 *   - `CONFIG SET` rewrites server config (`CONFIG SET dir …` is the classic RCE step)
 *     without adding or removing a single key;
 *   - `MEMORY PURGE`, `LATENCY RESET`, `CLIENT KILL`, `SCRIPT LOAD` likewise mutate
 *     server state while leaving the keyspace untouched.
 * A command that is uninteresting to a tree refresh can still be a write. Keep the sets
 * separate on purpose.
 *
 * Same fail-safe contract as the SQL classifier ({@link ../read-only/sql}): anything not
 * PROVEN to be a pure read returns `false` and is therefore blocked.
 */

/**
 * Verbs that are a pure read on their own, with no subcommand to disambiguate.
 * Deliberately conservative — an omission costs a user a refusal, an over-inclusion
 * costs them a write they forbade.
 */
const READ_VERBS = new Set([
  // strings / generic
  'GET',
  'MGET',
  'GETRANGE',
  'SUBSTR',
  'STRLEN',
  'GETBIT',
  'BITCOUNT',
  'BITPOS',
  'KEYS',
  'SCAN',
  'TYPE',
  'TTL',
  'PTTL',
  'EXPIRETIME',
  'PEXPIRETIME',
  'EXISTS',
  'DBSIZE',
  'RANDOMKEY',
  'DUMP',
  'KEYSPACE',
  // hashes
  'HGET',
  'HGETALL',
  'HKEYS',
  'HVALS',
  'HLEN',
  'HMGET',
  'HEXISTS',
  'HSCAN',
  'HSTRLEN',
  'HRANDFIELD',
  // lists
  'LRANGE',
  'LLEN',
  'LINDEX',
  'LPOS',
  // sets
  'SMEMBERS',
  'SCARD',
  'SISMEMBER',
  'SMISMEMBER',
  'SSCAN',
  'SRANDMEMBER',
  'SDIFF',
  'SINTER',
  'SUNION',
  'SINTERCARD',
  // sorted sets
  'ZRANGE',
  'ZRANGEBYSCORE',
  'ZREVRANGE',
  'ZREVRANGEBYSCORE',
  'ZRANGEBYLEX',
  'ZREVRANGEBYLEX',
  'ZCARD',
  'ZSCORE',
  'ZMSCORE',
  'ZRANK',
  'ZREVRANK',
  'ZCOUNT',
  'ZLEXCOUNT',
  'ZSCAN',
  'ZRANDMEMBER',
  // streams
  'XRANGE',
  'XREVRANGE',
  'XLEN',
  'XREAD',
  // geo
  'GEODIST',
  'GEOPOS',
  'GEOHASH',
  // HyperLogLog has no allowlisted verb: PFADD/PFMERGE are obvious writes, and Redis
  // documents PFCOUNT as technically writing the cached cardinality back into the key
  // (it can propagate that representation change to replicas/AOF).
  // server introspection
  'PING',
  'INFO',
  'ECHO',
  'TIME',
  'LASTSAVE',
  'DBSIZE',
])

/**
 * Container commands whose read/write nature depends on the SUBCOMMAND. Only the listed
 * read subcommands pass; every other (and a bare verb with none) fails safe. This is the
 * half a flat verb whitelist gets wrong — `CONFIG GET` vs `CONFIG SET`.
 */
const READ_SUBCOMMANDS: Record<string, Set<string>> = {
  CONFIG: new Set(['GET']),
  CLIENT: new Set(['ID', 'INFO', 'LIST', 'GETNAME']),
  MEMORY: new Set(['USAGE', 'STATS', 'DOCTOR']),
  LATENCY: new Set(['HISTORY', 'LATEST', 'DOCTOR', 'GRAPH']),
  OBJECT: new Set(['ENCODING', 'FREQ', 'IDLETIME', 'REFCOUNT', 'HELP']),
  COMMAND: new Set(['COUNT', 'DOCS', 'INFO', 'GETKEYS', 'LIST', 'HELP']),
  CLUSTER: new Set(['INFO', 'NODES', 'SLOTS', 'SHARDS', 'MYID', 'COUNTKEYSINSLOT']),
  XINFO: new Set(['STREAM', 'GROUPS', 'CONSUMERS']),
  SLOWLOG: new Set(['GET', 'LEN']),
  ACL: new Set(['CAT', 'LIST', 'GETUSER', 'USERS', 'WHOAMI']),
}

/**
 * True only if `command` is PROVEN to be a pure Redis read. Empty input, an unknown verb,
 * a container command without a recognized read subcommand, or anything else → `false`.
 *
 * Only the FIRST command on the line is considered because the Redis console executes one
 * command per call ({@link ../drivers/redis-protocol.parseRedisCommand} tokenizes a single
 * line); there is no statement separator to split on, so there is no multi-command case to
 * fail open on.
 */
export function isReadOnlyRedisCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  const verb = tokens[0]?.toUpperCase()
  if (!verb) return false
  const subs = READ_SUBCOMMANDS[verb]
  if (subs) {
    const sub = tokens[1]?.toUpperCase()
    return sub !== undefined && subs.has(sub)
  }
  return READ_VERBS.has(verb)
}
