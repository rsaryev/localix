/**
 * Redis driver (engine kind 'kv') over Bun's built-in `RedisClient` — zero npm deps.
 * A thin I/O wrapper around the pure {@link parseRedisCommand}/{@link shapeRedisReply}
 * kernel: `query` runs one raw Redis command and shapes the reply into the console grid's
 * {@link DbResultSet}; `schemas` SCANs the keyspace and groups keys by their `:`-prefix
 * into a pseudo-schema tree.
 *
 * There is no in-process Redis to integration-test against here, so the tricky logic lives
 * in the tested kernel and this wrapper stays deliberately thin.
 */
import { CONNECT_TIMEOUT_MS } from './connect-timeout'
import { RedisClient, type RedisOptions } from 'bun'
import {
  driverFlags,
  type DbDriver,
  type DbResultSet,
  type DbSchemas,
  type DbTableSchema,
} from './port'
import {
  abbreviateRedisType,
  decodeRedisBytes,
  parseRedisCommand,
  REDIS_SCAN_MAX_ROUNDS,
  scanRedisPage,
  shapeRedisPairs,
  shapeRedisReply,
} from './redis-protocol'
import type { DriverConnInput } from './connection-input'
import { getDatabaseDriverManifest } from '../../shared/driver-catalog'
import { recordArray } from '../../shared/safe-record'

export type RedisDriverOptions = DriverConnInput

/** Cap the keyspace scan so a huge database can't stall the browser. */
const SCAN_LIMIT = 1000
const REDIS_DEFAULT_PORT = getDatabaseDriverManifest('redis').defaultPort!

/**
 * Build the `redis://`/`rediss://` URL Bun's client connects with. A user-supplied `url`
 * wins as-is; discrete fields are assembled (credentials URL-encoded, numeric `database`
 * as the path's db index). TLS: `ssl: true` → the `rediss://` scheme; an object rides the
 * client's `tls` option (CA/cert/key) alongside the scheme.
 */
function buildRedisUrl(options: RedisDriverOptions): string {
  if (options.url) return options.url
  const scheme = options.ssl ? 'rediss' : 'redis'
  const user = options.user ? encodeURIComponent(options.user) : ''
  const pass = options.password ? encodeURIComponent(options.password) : ''
  const auth = user || pass ? `${user}:${pass}@` : ''
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? REDIS_DEFAULT_PORT
  const db =
    options.database != null && options.database !== '' && Number.isFinite(Number(options.database))
      ? `/${Number(options.database)}`
      : ''
  return `${scheme}://${auth}${host}:${port}${db}`
}

/** Build Bun Redis options; TLS is valid alongside both a URL and discrete fields. */
export function buildRedisClientOptions(options: RedisDriverOptions): RedisOptions {
  return {
    connectionTimeout: CONNECT_TIMEOUT_MS,
    autoReconnect: false,
    maxRetries: 0,
    ...(options.ssl ? { tls: options.ssl } : {}),
  }
}

export function createRedisDriver(options: RedisDriverOptions): DbDriver {
  // Fail fast on a bad host: one attempt, short connect timeout, no reconnect loop —
  // the service probes on connect, so a refused/unreachable host should error immediately
  // instead of retrying in the background.
  const redis = new RedisClient(buildRedisUrl(options), buildRedisClientOptions(options))
  // Bun reports connection trouble through `onclose`; `connect()` on a refused/unreachable
  // host can reject with a generic failure while the concrete ECONNREFUSED/ENOTFOUND arrives
  // here. Record the last close error so `ensure` can surface the mappable code `mapDbError`
  // needs (host_unreachable / auth_failed) instead of a bare query_failed.
  let lastError: unknown = null
  redis.onclose = (err) => {
    lastError = err
  }
  let connected = false
  const target =
    options.url ?? `${options.host ?? '127.0.0.1'}:${options.port ?? REDIS_DEFAULT_PORT}`
  async function ensure(): Promise<void> {
    if (!connected) {
      try {
        await redis.connect()
      } catch (err) {
        // Prefer the concrete connection error from `onclose` over a generic rejection.
        const cause = lastError ?? err
        const e = cause as { code?: string; message?: string }
        const msg = String(e?.message ?? cause)
        // Bun reports a refused/unreachable TCP connect as a generic "Connection closed"
        // (ERR_REDIS_CONNECTION_CLOSED) — too vague for `mapDbError`. Recast the
        // connect-phase failure as "could not connect …" (a host_unreachable phrase),
        // unless the server itself replied (auth errors carry WRONGPASS/NOAUTH/AUTH).
        if (e?.code === 'ERR_REDIS_CONNECTION_CLOSED' && !/wrongpass|noauth|auth/i.test(msg)) {
          throw new Error(`could not connect to Redis at ${target}: ${msg}`, { cause })
        }
        throw cause
      }
      connected = true
    }
  }

  const flags = driverFlags('redis')

  async function probe(): Promise<void> {
    await ensure()
    await redis.send('PING', [])
  }

  async function query(command: string): Promise<ReturnType<typeof shapeRedisReply>> {
    await ensure()
    const argv = parseRedisCommand(command)
    if (argv.length === 0) return shapeRedisReply(null, 0)
    const start = performance.now()
    const [cmd, ...args] = argv
    // `send` runs an arbitrary command; args are already strings from the protocol parser.
    const reply: unknown =
      cmd!.toUpperCase() === 'GET' && args.length === 1
        ? decodeRedisBytes(await redis.getBuffer(args[0]!))
        : await redis.send(cmd!, args)
    return shapeRedisReply(reply, performance.now() - start)
  }

  const browse: DbDriver['browse'] = async ({ table: key, limit, offset }) => {
    await ensure()
    const start = performance.now()
    const type = String(await redis.send('TYPE', [key])).toLowerCase()
    let result: DbResultSet
    if (type === 'string') {
      result =
        offset === 0
          ? shapeRedisReply(decodeRedisBytes(await redis.getBuffer(key)), 0)
          : { columns: [{ name: 'value' }], rows: [], durationMs: 0 }
    } else if (type === 'list') {
      result = shapeRedisReply(
        await redis.send('LRANGE', [key, String(offset), String(offset + limit - 1)]),
        0,
      )
    } else if (type === 'hash') {
      const values = await scanRedisPage(
        (command, args) => redis.send(command, args),
        'HSCAN',
        key,
        offset,
        limit,
      )
      result = shapeRedisPairs(values, ['field', 'value'])
    } else if (type === 'set') {
      const values = await scanRedisPage(
        (command, args) => redis.send(command, args),
        'SSCAN',
        key,
        offset,
        limit,
      )
      result = shapeRedisReply(values, 0)
    } else if (type === 'zset') {
      const values = (await redis.send('ZRANGE', [
        key,
        String(offset),
        String(offset + limit - 1),
        'WITHSCORES',
      ])) as unknown[]
      result = shapeRedisPairs(Array.isArray(values) ? values : [], ['member', 'score'])
    } else if (type === 'stream') {
      const values = (await redis.send('XRANGE', [
        key,
        '-',
        '+',
        'COUNT',
        String(offset + limit),
      ])) as unknown[]
      result = shapeRedisReply(Array.isArray(values) ? values.slice(offset, offset + limit) : [], 0)
    } else {
      result = shapeRedisReply(null, 0)
    }
    return { ...result, durationMs: performance.now() - start }
  }

  async function schemas(): Promise<DbSchemas> {
    await ensure()
    // Non-blocking SCAN (never KEYS *) up to a cap; group keys by their first `:`-segment so
    // `user:1`, `user:2`, `cache:x` browse as folders. Ungrouped keys go under the default.
    const keys: string[] = []
    const seenKeys = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor = '0'
    let rounds = 0
    do {
      if (rounds >= REDIS_SCAN_MAX_ROUNDS) break
      rounds += 1
      const [next, batch] = (await redis.send('SCAN', [cursor, 'COUNT', '200'])) as [
        string,
        string[],
      ]
      cursor = next
      for (const key of batch) {
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        keys.push(key)
        if (keys.length === SCAN_LIMIT) break
      }
      // Redis permits duplicate values; a repeated cursor is not useful progress either.
      if (seenCursors.has(cursor)) break
      seenCursors.add(cursor)
    } while (cursor !== '0' && keys.length < SCAN_LIMIT)

    // TYPE + TTL for every scanned key → a data-type badge and an expiry indicator per key
    // in the tree. Issued concurrently on the one connection — Bun's client pipelines the
    // batch into a single round-trip, matching the old explicit pipeline.
    let meta: Array<{ type: string; ttl: number }> = []
    if (keys.length > 0) {
      meta = await Promise.all(
        keys.map(async (key) => {
          const [type, ttl] = await Promise.all([
            redis.send('TYPE', [key]) as Promise<unknown>,
            redis.send('TTL', [key]) as Promise<unknown>,
          ])
          return {
            type: typeof type === 'string' ? type : '',
            ttl: typeof ttl === 'number' ? ttl : -1,
          }
        }),
      )
    }

    const out: DbSchemas = {}
    keys.forEach((key, i) => {
      const idx = key.indexOf(':')
      const group = idx > 0 ? key.slice(0, idx) : flags.defaultSchema
      const badge = abbreviateRedisType(meta[i]?.type ?? '')
      const ttl = meta[i]?.ttl ?? -1
      recordArray(out, group).push({
        name: key,
        type: 'table',
        ...(badge ? { badge } : {}),
        ...(ttl > 0 ? { ttl } : {}),
      })
    })
    // Always surface the default group so an empty keyspace still renders a node.
    if (Object.keys(out).length === 0) recordArray(out, flags.defaultSchema)
    return out
  }

  // A Redis key isn't a relational table; the kv browser fetches a key's value via `query`
  // instead. Return a minimal stub so the SQL-shaped port stays satisfied.
  async function tableSchema(_schema: string | undefined, key: string): Promise<DbTableSchema> {
    return { name: key, type: 'table', columns: [], primaryKey: [], foreignKeys: [], indexes: [] }
  }

  async function close(): Promise<void> {
    redis.close()
  }

  return { getFlags: () => flags, query, probe, browse, schemas, tableSchema, close }
}
