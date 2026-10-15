/**
 * MongoDB driver (engine kind 'document') over the `mongodb` package. A thin I/O wrapper
 * around the pure {@link parseMongoCommand}/{@link shapeMongoResult} kernel: `query` runs one
 * `db.<collection>.<method>(...)` shell-style command and shapes the documents into the grid's
 * {@link DbResultSet}; `schemas` lists collections as the browsable tree.
 *
 * No in-process Mongo to integration-test here, so the parsing/shaping lives in the tested
 * kernel and this wrapper stays thin.
 */
import { CONNECT_TIMEOUT_MS } from './connect-timeout'
import { MongoClient, type MongoClientOptions } from 'mongodb'
import { driverFlags, type DbDriver, type DbSchemas, type DbTableSchema } from './port'
import { parseMongoCommand, shapeMongoResult } from './mongo-query'
import type { DriverConnInput } from './connection-input'
import { RESULT_ROW_CAP } from '../../shared/result-cap'

export type MongoDriverOptions = DriverConnInput

/** Default row cap on an unbounded `find` so a huge collection can't flood the grid. */
const FIND_LIMIT = 1000

export function boundedFindLimit(requested: unknown): number {
  if (typeof requested !== 'number' || requested === 0) return FIND_LIMIT
  const magnitude = Math.min(Math.abs(requested), FIND_LIMIT)
  return requested < 0 ? -magnitude : magnitude
}

export function buildMongoFindOptions(
  projection: Record<string, unknown> | null | undefined,
  supplied: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // The explicit second projection argument has mongosh precedence. Passing null lets the
  // caller use `options.projection`, matching the documented three-argument form.
  return { ...supplied, ...(projection ? { projection } : {}) }
}

/**
 * Connect once, sharing the attempt: two calls arriving together (the schema tree and a console
 * query on a fresh connection) used to each start `client.connect()`. A failed attempt is
 * forgotten so the next call retries instead of replaying the old error forever.
 */
export function singleFlightConnect(connect: () => Promise<unknown>): () => Promise<void> {
  let attempt: Promise<void> | undefined
  return () =>
    (attempt ??= connect().then(
      () => undefined,
      (err: unknown) => {
        attempt = undefined
        throw err
      },
    ))
}

interface ClosableCursor<T> extends AsyncIterable<T> {
  close(): Promise<void>
}

/**
 * Read at most `cap` documents from a cursor, then close it. Reading one past the cap is what
 * makes `truncated` honest; stopping there keeps an unbounded `aggregate` from loading a whole
 * collection into the API process. `$out`/`$merge` stages finish server-side before the first
 * batch, so closing early never changes what the pipeline does.
 */
export async function collectCapped<T>(
  cursor: ClosableCursor<T>,
  cap = RESULT_ROW_CAP,
): Promise<{ documents: T[]; truncated: boolean }> {
  const documents: T[] = []
  let truncated = false
  try {
    for await (const document of cursor) {
      if (documents.length >= cap) {
        truncated = true
        break
      }
      documents.push(document)
    }
  } finally {
    await cursor.close()
  }
  return { documents, truncated }
}

/** Cap an array the server already returned whole (`distinct` has no cursor form). */
export function capValues<T>(
  values: T[],
  cap = RESULT_ROW_CAP,
): { documents: T[]; truncated: boolean } {
  return values.length > cap
    ? { documents: values.slice(0, cap), truncated: true }
    : { documents: values, truncated: false }
}

/** Build a credential-free `mongodb://host[:port]/database` URL from discrete fields;
 *  user/password go through the client `auth` option (no URL-encoding pitfalls). */
function buildMongoUrl(options: DriverConnInput): string {
  const host = options.host ?? 'localhost'
  const hostPort = options.port ? `${host}:${options.port}` : host
  return `mongodb://${hostPort}/${options.database ?? ''}`
}

/** Build MongoClient options for URL and field modes, including Node-native PEM values. */
export function buildMongoClientOptions(options: MongoDriverOptions): MongoClientOptions {
  const clientOpts: MongoClientOptions = {
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    // Native bigint lets the result transport emit exact decimal text for BSON int64 values
    // instead of exposing Long's internal low/high words or risking Number coercion.
    useBigInt64: true,
  }
  if (!options.url && options.user) {
    clientOpts.auth = { username: options.user, password: options.password ?? '' }
  }
  const ssl = options.ssl
  if (ssl === true) {
    clientOpts.tls = true
  } else if (ssl && typeof ssl === 'object') {
    // MongoClientOptions includes the supported Node TLS socket options. Passing PEM text
    // via ca/cert/key avoids temp files and works alongside either a URI or field config.
    Object.assign(clientOpts, ssl, { tls: true })
  }
  return clientOpts
}

export function createMongoDriver(options: MongoDriverOptions): DbDriver {
  const url = options.url ?? buildMongoUrl(options)
  const clientOpts = buildMongoClientOptions(options)
  const client = new MongoClient(url, clientOpts)
  const ensure = singleFlightConnect(() => client.connect())

  const flags = driverFlags('mongodb')

  async function probe(): Promise<void> {
    await ensure()
    await client.db().command({ ping: 1 })
  }

  async function query(command: string): Promise<ReturnType<typeof shapeMongoResult>> {
    await ensure()
    const { collection, method, args } = parseMongoCommand(command)
    const coll = client.db().collection(collection)
    const start = performance.now()
    let result: unknown
    let truncated = false
    switch (method) {
      case 'find': {
        const projection = args[1] as Record<string, unknown> | null | undefined
        const options = buildMongoFindOptions(
          projection,
          args[2] as Record<string, unknown> | undefined,
        )
        result = await coll
          .find((args[0] ?? {}) as Record<string, unknown>, options)
          .limit(boundedFindLimit(options.limit))
          .toArray()
        break
      }
      case 'findOne': {
        const projection = args[1] as Record<string, unknown> | null | undefined
        const options = buildMongoFindOptions(
          projection,
          args[2] as Record<string, unknown> | undefined,
        )
        result = await coll.findOne((args[0] ?? {}) as Record<string, unknown>, options)
        break
      }
      case 'aggregate': {
        const capped = await collectCapped(
          coll.aggregate(
            (args[0] ?? []) as Record<string, unknown>[],
            (args[1] ?? {}) as Record<string, unknown>,
          ),
        )
        result = capped.documents
        truncated = capped.truncated
        break
      }
      case 'countDocuments':
        result = await coll.countDocuments(
          (args[0] ?? {}) as Record<string, unknown>,
          (args[1] ?? {}) as Record<string, unknown>,
        )
        break
      case 'count':
        result = await coll.count(
          (args[0] ?? {}) as Record<string, unknown>,
          (args[1] ?? {}) as Record<string, unknown>,
        )
        break
      case 'distinct': {
        const capped = capValues(
          await coll.distinct(
            args[0] as string,
            (args[1] ?? {}) as Record<string, unknown>,
            (args[2] ?? {}) as Record<string, unknown>,
          ),
        )
        result = capped.documents
        truncated = capped.truncated
        break
      }
    }
    const shaped = shapeMongoResult(result, performance.now() - start)
    return truncated ? { ...shaped, truncated } : shaped
  }

  const browse: DbDriver['browse'] = async ({ table, limit, offset, sort }) => {
    await ensure()
    const start = performance.now()
    let cursor = client.db().collection(table).find({})
    if (sort) cursor = cursor.sort({ [sort.column]: sort.direction === 'desc' ? -1 : 1 })
    const documents = await cursor.skip(offset).limit(limit).toArray()
    return shapeMongoResult(documents, performance.now() - start)
  }

  async function schemas(): Promise<DbSchemas> {
    await ensure()
    const db = client.db()
    const cols = await db.listCollections({}, { nameOnly: true }).toArray()
    const items = cols.map((c) => ({ name: c.name, type: 'table' as const }))
    return { [db.databaseName || flags.defaultSchema]: items }
  }

  // A Mongo collection is schemaless, so there are no fixed columns; the doc console reads a
  // collection via `find`. Return a minimal stub so the SQL-shaped port stays satisfied.
  async function tableSchema(
    _schema: string | undefined,
    collection: string,
  ): Promise<DbTableSchema> {
    return {
      name: collection,
      type: 'table',
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      indexes: [],
    }
  }

  async function close(): Promise<void> {
    await client.close().catch(() => {})
  }

  return { getFlags: () => flags, query, probe, browse, schemas, tableSchema, close }
}
