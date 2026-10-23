import sql from 'mssql'
import { CONNECT_TIMEOUT_MS } from './connect-timeout'
import type { DriverConnInput } from './connection-input'

/** Map our `ssl` shape → tedious TLS options.
 *  ssl unset → encrypt OFF (matches every other network driver: "unset = no TLS"; tedious's
 *  own default is encrypt=true, which fails outright against a host given by IP — see below).
 *  ssl false → encrypt off; ssl truthy → encrypt on, trusting a self-signed cert when
 *  `rejectUnauthorized:false`. */
function tlsOptions(ssl: DriverConnInput['ssl']): {
  encrypt: boolean
  trustServerCertificate?: true
  cryptoCredentialsDetails?: {
    ca?: string
    cert?: string
    key?: string
  }
} {
  const encrypt = ssl === undefined ? false : ssl !== false
  const trustServerCertificate = typeof ssl === 'object' && ssl.rejectUnauthorized === false
  const cryptoCredentialsDetails =
    typeof ssl === 'object'
      ? {
          ...(ssl.ca ? { ca: ssl.ca } : {}),
          ...(ssl.cert ? { cert: ssl.cert } : {}),
          ...(ssl.key ? { key: ssl.key } : {}),
        }
      : {}
  return {
    encrypt,
    ...(trustServerCertificate ? { trustServerCertificate: true } : {}),
    ...(Object.keys(cryptoCredentialsDetails).length > 0 ? { cryptoCredentialsDetails } : {}),
  }
}

/**
 * Build the `mssql` ConnectionPool input from our agnostic {@link DriverConnInput}.
 *
 * The `mssql` package accepts a config OBJECT or an ADO CONNECTION STRING (`Server=host,port;…`)
 * — NOT a `mssql://`/`sqlserver://` URI (unlike postgres.js / mysql2 / ioredis / mongodb, whose
 * clients each parse their own URL scheme). So a URI is parsed here into a config; a bare ADO
 * connection string is passed through verbatim.
 *
 * Encryption: for discrete fields and for a parsed URI we default `encrypt:false` (no TLS unless
 * asked) — tedious otherwise defaults `encrypt:true`, and encrypting to a host given by IP throws
 * "Setting the TLS ServerName to an IP address is not permitted", so a plain localhost/Docker/IP
 * connection would fail. A URI may still opt in with `?encrypt=true[&trustServerCertificate=true]`.
 */
export function buildMssqlPoolConfig(options: DriverConnInput): sql.config | string {
  if (options.url) {
    const trimmedUrl = options.url.trim()
    // A URI (has a `scheme://` authority) → parse to a config; else it's an ADO connection
    // string. Keep a plain ADO string untouched unless a separate TLS override must be
    // merged; mssql's own parser then preserves all its non-TLS options for us. The public
    // contract accepts surrounding URL whitespace, so scheme detection and WHATWG parsing
    // must use the same trimmed view as validation.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl)) {
      if (options.ssl === undefined) return options.url
      const parsed = sql.ConnectionPool.parseConnectionString(options.url)
      return {
        ...parsed,
        options: { ...parsed.options, ...tlsOptions(options.ssl) },
      }
    }
    const u = new URL(trimmedUrl)
    const enc = u.searchParams.get('encrypt')
    const trust =
      u.searchParams.get('trustServerCertificate') ?? u.searchParams.get('trustservercertificate')
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    }
    return {
      connectionTimeout: CONNECT_TIMEOUT_MS,
      server: u.hostname ? dec(u.hostname) : 'localhost',
      ...(u.port ? { port: Number(u.port) } : {}),
      ...(u.username ? { user: dec(u.username) } : {}),
      ...(u.password ? { password: dec(u.password) } : {}),
      ...(u.pathname && u.pathname !== '/' ? { database: dec(u.pathname.replace(/^\//, '')) } : {}),
      options:
        options.ssl !== undefined
          ? tlsOptions(options.ssl)
          : {
              encrypt: enc == null ? false : enc !== 'false',
              ...(trust === 'true' ? { trustServerCertificate: true } : {}),
            },
    }
  }
  return {
    connectionTimeout: CONNECT_TIMEOUT_MS,
    server: options.host ?? 'localhost',
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.password !== undefined ? { password: options.password } : {}),
    ...(options.database !== undefined ? { database: options.database } : {}),
    options: tlsOptions(options.ssl),
  }
}
