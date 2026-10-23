import { describe, expect, test } from 'bun:test'
import https from 'node:https'
import { RESULT_ROW_CAP } from '../../shared/result-cap'
import {
  bindClickHouseParams,
  buildClickHouseClientConfig,
  CAPPED_RESULT_SETTINGS,
  isClickHouseNullableType,
  isClickHouseRowQuery,
  parseClickHouseJsonExact,
  stripClickHouseOutputFormat,
} from './clickhouse'

describe('ClickHouse row cap', () => {
  test('the server stops one row past the shared cap and returns what it has', () => {
    // `throw` (the server default) would turn a large result into an error, not a capped one;
    // cap+1 rather than cap is what lets the driver tell "exactly N" from "more than N".
    expect(CAPPED_RESULT_SETTINGS).toEqual({
      max_result_rows: String(RESULT_ROW_CAP + 1),
      result_overflow_mode: 'break',
    })
  })
})

describe('ClickHouse parameter adapter', () => {
  test('maps the standard positional port onto typed ClickHouse query params', () => {
    expect(
      bindClickHouseParams(
        `SELECT * FROM events WHERE tenant = ? AND attempts > ? AND active = ?`,
        ['acme', 2, true],
      ),
    ).toEqual({
      query:
        'SELECT * FROM events WHERE tenant = {p0:String} AND attempts > {p1:Int64} AND active = {p2:Bool}',
      queryParams: { p0: 'acme', p1: 2, p2: true },
    })
  })

  test('does not rewrite question marks inside strings, identifiers or comments', () => {
    const bound = bindClickHouseParams(
      `SELECT '?' AS literal, "?" AS identifier -- ?\nWHERE id = ? /* ? */`,
      [7],
    )
    expect(bound.query).toBe(
      `SELECT '?' AS literal, "?" AS identifier -- ?\nWHERE id = {p0:Int64} /* ? */`,
    )
    expect(bound.queryParams).toEqual({ p0: 7 })
  })

  test('honours backslash escapes, so a ? inside an escaped literal is not bound', () => {
    // ClickHouse accepts `\'` as well as `''`. Without the escape rule the scanner
    // thinks the literal ENDS at `\'`, binds the `?` that is still inside it, and
    // leaves the real placeholder raw — and because the count still matches, the
    // arity guard passes and the breakage reaches the server instead of throwing.
    // The console's own scanner (ui/model/sqlParams.ts) has always honoured `\`, so
    // this is also a front-end/back-end grammar disagreement about the same SQL.
    const bound = bindClickHouseParams(`SELECT * FROM t WHERE note = 'it\\'s ?' AND id = ?`, [7])
    expect(bound.query).toBe(`SELECT * FROM t WHERE note = 'it\\'s ?' AND id = {p0:Int64}`)
    expect(bound.queryParams).toEqual({ p0: 7 })
  })

  test('a trailing backslash cannot run the scanner past the end of the SQL', () => {
    // `'a\` — the escape consumes the closing quote; the loop must still terminate.
    expect(() => bindClickHouseParams(`SELECT 'a\\`, [1])).toThrow(/more values/)
  })

  test('binds inside an array literal — `[…]` is CODE in ClickHouse, not an identifier', () => {
    // This is why the shared scanner takes the grammar as a parameter instead of handling
    // brackets unconditionally: T-SQL's `[ident]` and ClickHouse's `[1,2,3]` look identical
    // and mean opposite things. Skipping brackets here would drop both placeholders.
    const bound = bindClickHouseParams('SELECT [?, ?] AS arr', [1, 2])
    expect(bound.query).toBe('SELECT [{p0:Int64}, {p1:Int64}] AS arr')
    expect(bound.queryParams).toEqual({ p0: 1, p1: 2 })
  })

  test('fails closed when placeholder and value counts differ', () => {
    expect(() => bindClickHouseParams('SELECT ?', [1, 2])).toThrow(/more values/)
    expect(() => bindClickHouseParams('SELECT ? + ?', [1])).toThrow(/more placeholders/)
  })
})

describe('ClickHouse TLS config', () => {
  test('normalizes ClickHouse URL aliases before handing them to the HTTP client', () => {
    expect(
      buildClickHouseClientConfig({
        url: 'clickhouse://reader:secret@clickhouse.example:8123/analytics',
      }).url,
    ).toBe('http://reader:secret@clickhouse.example:8123/analytics')
    expect(
      buildClickHouseClientConfig({
        url: 'clickhouses://reader:secret@clickhouse.example:8443/analytics',
      }).url,
    ).toBe('https://reader:secret@clickhouse.example:8443/analytics')
    expect(buildClickHouseClientConfig({ host: 'clickhouse.example', ssl: true }).url).toBe(
      'https://clickhouse.example:8443',
    )
  })

  test('applies a separate TLS override to URL scheme and protocol-default port', () => {
    expect(
      buildClickHouseClientConfig({
        url: 'clickhouse://reader@clickhouse.example/analytics',
        ssl: true,
      }).url,
    ).toBe('https://reader@clickhouse.example:8443/analytics')
    expect(
      buildClickHouseClientConfig({
        url: 'https://clickhouse.example/analytics',
        ssl: false,
      }).url,
    ).toBe('http://clickhouse.example:8123/analytics')
    expect(
      buildClickHouseClientConfig({
        url: 'http://clickhouse.example:9443/analytics',
        ssl: true,
      }).url,
    ).toBe('https://clickhouse.example:9443/analytics')
  })

  test('uses ClickHouse HTTP ports when a URL omits its port', () => {
    expect(buildClickHouseClientConfig({ url: 'http://clickhouse.example/default' }).url).toBe(
      'http://clickhouse.example:8123/default',
    )
    expect(buildClickHouseClientConfig({ url: 'https://clickhouse.example/default' }).url).toBe(
      'https://clickhouse.example:8443/default',
    )
  })

  test('keeps verification, custom trust, and client identity on one HTTPS agent', () => {
    const config = buildClickHouseClientConfig({
      url: 'https://clickhouse.example:8443',
      user: 'reader',
      password: 'secret',
      ssl: {
        rejectUnauthorized: false,
        ca: 'CA PEM',
        cert: 'CERT PEM',
        key: 'KEY PEM',
      },
    })

    expect(config.tls).toBeUndefined()
    expect(config.http_agent).toBeInstanceOf(https.Agent)
    expect((config.http_agent as https.Agent).options).toMatchObject({
      keepAlive: true,
      maxSockets: 2,
      rejectUnauthorized: false,
      ca: Buffer.from('CA PEM'),
      cert: Buffer.from('CERT PEM'),
      key: Buffer.from('KEY PEM'),
    })
    expect(config.set_basic_auth_header).toBe(false)
    expect(config.http_headers).toEqual({
      'X-ClickHouse-User': 'reader',
      'X-ClickHouse-Key': 'secret',
      'X-ClickHouse-SSL-Certificate-Auth': 'on',
    })
  })

  test('supports client certificates with the platform CA set', () => {
    const config = buildClickHouseClientConfig({
      url: 'https://clickhouse.example:8443',
      ssl: { cert: 'CERT PEM', key: 'KEY PEM' },
    })
    expect((config.http_agent as https.Agent).options).toMatchObject({
      cert: Buffer.from('CERT PEM'),
      key: Buffer.from('KEY PEM'),
    })
  })

  test('keeps URL credentials when a custom mTLS agent owns authentication headers', () => {
    const config = buildClickHouseClientConfig({
      url: 'clickhouses://url-user:p%40ss@clickhouse.example:8443/analytics',
      ssl: { cert: 'CERT PEM', key: 'KEY PEM' },
    })
    expect(config.http_headers).toEqual({
      'X-ClickHouse-User': 'url-user',
      'X-ClickHouse-Key': 'p@ss',
      'X-ClickHouse-SSL-Certificate-Auth': 'on',
    })
  })
})

describe('ClickHouse exact JSON transport', () => {
  test('preserves unsafe integers and decimals while retaining ordinary numbers', () => {
    const payload =
      '{"meta":[{"name":"id","type":"UInt64"}],"data":[[42,9007199254740993,98765432109876.123456789012345678]]}'

    // The parser is generic with `T = unknown`; an `unknown` received value collapses bun's
    // `toEqual` overloads to the no-argument one. Naming the shape is what the assertion means
    // anyway — and it now checks that the exact-JSON transport really produces this envelope.
    expect(
      parseClickHouseJsonExact<{
        meta: Array<{ name: string; type: string }>
        data: Array<Array<number | string>>
      }>(payload),
    ).toEqual({
      meta: [{ name: 'id', type: 'UInt64' }],
      data: [[42, '9007199254740993', '98765432109876.123456789012345678']],
    })
    expect(buildClickHouseClientConfig({ host: 'localhost' }).json?.parse).toBe(
      parseClickHouseJsonExact,
    )
  })

  test('preserves prototype-named JSON fields without prototype pollution', () => {
    const parsed = parseClickHouseJsonExact(
      '{"data":[{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"ok":1}]}',
    ) as { data: Array<Record<string, unknown>> }
    expect(Object.getPrototypeOf(parsed.data[0]!)).toBeNull()
    expect(parsed).toEqual({
      data: [
        {
          ['__proto__']: { polluted: true },
          constructor: { prototype: { polluted: true } },
          ok: 1,
        },
      ],
    })
    expect(Object.prototype).not.toHaveProperty('polluted')
  })
})

describe('ClickHouse column types', () => {
  test('recognizes nullability through transparent type wrappers only', () => {
    expect(isClickHouseNullableType('Nullable(String)')).toBe(true)
    expect(isClickHouseNullableType('LowCardinality(Nullable(String))')).toBe(true)
    expect(
      isClickHouseNullableType(
        "SimpleAggregateFunction(anyLast, LowCardinality(Nullable(Enum8('a,b' = 1, 'c' = 2))))",
      ),
    ).toBe(true)

    expect(isClickHouseNullableType('String')).toBe(false)
    expect(isClickHouseNullableType('Array(Nullable(String))')).toBe(false)
    expect(isClickHouseNullableType('Tuple(value Nullable(String), count UInt64)')).toBe(false)
    expect(isClickHouseNullableType('AggregateFunction(anyLast, Nullable(String))')).toBe(false)
  })
})

describe('ClickHouse transport routing', () => {
  test('keeps valid reads with write-keyword quoted identifiers on the row path', () => {
    expect(isClickHouseRowQuery('SELECT `drop`, `delete` FROM t')).toBe(true)
    expect(isClickHouseRowQuery('DROP TABLE t')).toBe(false)
  })

  test('routes ClickHouse metadata and diagnostic result sets through query()', () => {
    expect(isClickHouseRowQuery('SHOW CREATE TABLE events')).toBe(true)
    expect(isClickHouseRowQuery('SHOW GRANTS')).toBe(true)
    expect(isClickHouseRowQuery('EXISTS TABLE events')).toBe(true)
    expect(isClickHouseRowQuery('EXPLAIN AST ALTER TABLE events DELETE WHERE id = 1')).toBe(true)
    expect(isClickHouseRowQuery('CHECK TABLE events')).toBe(true)
    expect(isClickHouseRowQuery('CHECK ALL TABLES')).toBe(true)
    expect(isClickHouseRowQuery('CHECK GRANT SELECT ON db.events')).toBe(true)
    expect(isClickHouseRowQuery(`KILL QUERY WHERE query_id = 'abc' TEST`)).toBe(true)
    expect(isClickHouseRowQuery('WATCH event_stream EVENTS LIMIT 1')).toBe(true)
  })

  test('keeps output-free and redirected statements on command()', () => {
    expect(isClickHouseRowQuery('CHECK DATABASE analytics')).toBe(false)
    expect(isClickHouseRowQuery(`SHOW CREATE TABLE events INTO OUTFILE '/tmp/events.sql'`)).toBe(
      false,
    )
    expect(isClickHouseRowQuery('SHOW TABLES; DROP TABLE events')).toBe(false)
  })
})

describe('ClickHouse output formats', () => {
  test('removes a user-selected wire format that client.query() would duplicate', () => {
    expect(stripClickHouseOutputFormat('SELECT 1 FORMAT CSV')).toBe('SELECT 1')
    expect(stripClickHouseOutputFormat('SELECT 1 FORMAT JSONEachRow;')).toBe('SELECT 1;')
    expect(
      stripClickHouseOutputFormat(
        'SELECT * FROM events FORMAT PrettyCompact SETTINGS output_format_pretty_max_rows = 20',
      ),
    ).toBe('SELECT * FROM events SETTINGS output_format_pretty_max_rows = 20')
  })

  test('only removes the top-level output clause', () => {
    expect(
      stripClickHouseOutputFormat(
        `SELECT formatDateTime(ts, '%F') AS "FORMAT", format FROM events FORMAT TSV`,
      ),
    ).toBe(`SELECT formatDateTime(ts, '%F') AS "FORMAT", format FROM events`)
    expect(stripClickHouseOutputFormat(`SELECT * FROM format(JSONEachRow, 'id UInt64')`)).toBe(
      `SELECT * FROM format(JSONEachRow, 'id UInt64')`,
    )
    expect(stripClickHouseOutputFormat(`SELECT 'FORMAT CSV' AS note -- FORMAT TSV`)).toBe(
      `SELECT 'FORMAT CSV' AS note -- FORMAT TSV`,
    )
    expect(stripClickHouseOutputFormat('SELECT format FROM events')).toBe(
      'SELECT format FROM events',
    )
  })
})
