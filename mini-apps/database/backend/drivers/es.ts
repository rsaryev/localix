/**
 * Elasticsearch driver (engine kind 'search') over @elastic/elasticsearch. A thin wrapper over
 * the tested {@link parseEsCommand}/{@link shapeEsResult} kernel: `query` runs one
 * `<index>.<method>(<json>)` search-console command; `schemas` lists indices as the tree.
 *
 * No in-process ES to integration-test here, so parsing/shaping lives in the tested kernel.
 */
import { Client, HttpConnection } from '@elastic/elasticsearch'
import { driverFlags, type DbDriver, type DbSchemas, type DbTableSchema } from './port'
import { parseEsCommand, shapeEsResult, targetEsRequest } from './es-query'
import type { DriverConnInput } from './connection-input'
import { ExactEsSerializer } from './es-serializer'

export type EsDriverOptions = DriverConnInput

/** Default hit cap on a search that doesn't set its own `size`. */
const SEARCH_SIZE = 100

/** Build the Elasticsearch client config without opening a network connection. */
export function buildEsClientOptions(
  options: EsDriverOptions,
): ConstructorParameters<typeof Client>[0] {
  // A `url` is used as the node verbatim; discrete fields build an `http(s)://host[:port]` node
  // + `auth`. Advanced TLS options accompany either mode (bare `true` → `{}`).
  const ssl = options.ssl
  const scheme = ssl ? 'https' : 'http'
  const host = options.host ?? 'localhost'
  const node = options.url ?? `${scheme}://${options.port ? `${host}:${options.port}` : host}`
  const auth =
    !options.url && options.user
      ? { username: options.user, password: options.password ?? '' }
      : undefined
  const tls = ssl === true ? {} : ssl && typeof ssl === 'object' ? ssl : undefined
  return {
    node,
    requestTimeout: 8000,
    // The client's DEFAULT undici-based transport is broken under Bun (every request throws
    // "undefined is not an object (evaluating 'response.headers')"). The node:http-based
    // HttpConnection works under Bun, so pin it — the whole server runs on Bun.
    Connection: HttpConnection,
    // The default JSON parser rounds `long` and high-precision source values before the
    // result shaper can preserve them.
    Serializer: ExactEsSerializer,
    ...(auth ? { auth } : {}),
    ...(tls !== undefined ? { tls } : {}),
  }
}

export function createEsDriver(options: EsDriverOptions): DbDriver {
  const client = new Client(buildEsClientOptions(options))

  const flags = driverFlags('elasticsearch')

  // `ping()` is a HEAD request that the transport turns into `false` — not an error — on a
  // 404, so ANY web server answering 404 passed the connect probe and saved as a working
  // Elasticsearch connection. The boolean is the answer and must be read.
  async function probe(): Promise<void> {
    if (!(await client.ping())) {
      throw new Error(
        'The server answered the Elasticsearch ping with 404 — is this an Elasticsearch endpoint?',
      )
    }
  }

  // The transport's per-request `signal` is deliberately NOT passed. Its abort calls
  // `request.destroy(err)`, and under Bun's node:http that emits `close` but never `error`,
  // so an aborted search stayed pending FOREVER (measured) instead of failing at the 8 s
  // `requestTimeout`. `requestTimeout` stays the only bound until that changes.
  async function query(command: string): Promise<ReturnType<typeof shapeEsResult>> {
    const { index, method, args } = parseEsCommand(command)
    const body = (args[0] ?? {}) as Record<string, unknown>
    const start = performance.now()
    let result: unknown
    switch (method) {
      case 'search':
        // ES 8+/9 takes search params at the request top level; a user-supplied `size` wins.
        result = await client.search(targetEsRequest(index, { size: SEARCH_SIZE, ...body }))
        break
      case 'count':
        // Count accepts routing/min_score/terminate_after and other request parameters in
        // addition to `query`; forwarding only the query would silently change the result.
        result = await client.count(targetEsRequest(index, body))
        break
      case 'get':
        result = await client.get({ index, id: args[0] as string })
        break
    }
    return shapeEsResult(result, performance.now() - start)
  }

  const browse: DbDriver['browse'] = async ({ table, limit, offset, sort }) => {
    const start = performance.now()
    const result = await client.search({
      index: table,
      from: offset,
      size: limit,
      query: { match_all: {} },
      ...(sort ? { sort: [{ [sort.column]: { order: sort.direction } }] } : {}),
    })
    return shapeEsResult(result, performance.now() - start)
  }

  async function schemas(): Promise<DbSchemas> {
    // cat.indices lists user + system indices; hide the dot-prefixed internal ones.
    const rows = (await client.cat.indices({ format: 'json' })) as Array<{ index?: string }>
    const items = rows
      .map((r) => r.index)
      .filter((name): name is string => !!name && !name.startsWith('.'))
      .sort()
      .map((name) => ({ name, type: 'table' as const }))
    return { [flags.defaultSchema]: items }
  }

  // An ES index has dynamic mappings, not fixed relational columns; the console reads it via
  // `search`. Return a minimal stub so the SQL-shaped port stays satisfied.
  async function tableSchema(_schema: string | undefined, index: string): Promise<DbTableSchema> {
    return { name: index, type: 'table', columns: [], primaryKey: [], foreignKeys: [], indexes: [] }
  }

  async function close(): Promise<void> {
    await client.close().catch(() => {})
  }

  return { getFlags: () => flags, query, probe, browse, schemas, tableSchema, close }
}
