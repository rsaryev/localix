import { z } from 'zod'
// The connection color palette lives in the zod-free `colors.ts` leaf (so the UI can
// value-import it without pulling this schema module).
import { CONNECTION_COLORS } from '../colors'
import { isMssqlAdoConnectionString } from '../mssql-connection-string'
import {
  getDatabaseDriverManifest,
  isFileDatabaseDialect,
  isNetworkDatabaseDialect,
  type DbDialect,
} from '../../shared/driver-catalog'

/**
 * Fields every dialect config shares (spread into each variant so the discriminated
 * union stays object-shaped). `readonly` marks a connection as a WRITE GUARD-RAIL: the
 * agnostic service refuses any non-read statement on it (see `read-only.ts`). It is a
 * safety toggle, NOT a DB-permission boundary — a determined user with the raw
 * credentials can still write through other means. `color` is an optional presentational
 * tag (see `CONNECTION_COLORS`) — metadata only, never touched by query execution.
 */
const baseConnectionFields = {
  /** When true, the service blocks write/DDL statements on this connection. */
  readonly: z.boolean().optional(),
  /** Optional color tag for at-a-glance identification. Metadata only. */
  color: z.enum(CONNECTION_COLORS).optional(),
}

/**
 * TLS/SSL options for a network connection. `true` enables TLS with library defaults;
 * an object tunes it (`rejectUnauthorized: false` accepts a self-signed cert; `ca`/`cert`/`key`
 * are PEM strings for custom-CA / mutual-TLS). Each driver maps this ONE shape onto its
 * lib's native TLS option (see `drivers/connection-input.ts` + each driver's builder).
 */
export const sslSchema = z.union([
  z.boolean(),
  z
    .object({
      rejectUnauthorized: z.boolean().optional(),
      ca: z.string().optional(),
      cert: z.string().optional(),
      key: z.string().optional(),
    })
    .superRefine((ssl, ctx) => {
      const hasCert = !!ssl.cert?.trim()
      const hasKey = !!ssl.key?.trim()
      if (hasCert === hasKey) return
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A TLS client certificate and private key must be provided together.',
        path: [hasCert ? 'key' : 'cert'],
      })
    }),
])
export type DbSslConfig = z.infer<typeof sslSchema>

/**
 * Optional SSH-tunnel block for a network connection: when
 * present, the service opens an SSH connection to `host:port` (auth by `password` OR
 * `privateKey`/`passphrase`), forwards a local ephemeral 127.0.0.1 port to the DB target
 * parsed from the connection URL/host, and points the driver at that local port. The tunnel
 * is closed with the driver. `password`/`privateKey`/`passphrase` accept `${secret:KEY}`
 * tokens (resolved server-side at connect time, exactly like the DB password).
 */
export const sshTunnelConfigSchema = z
  .object({
    /** SSH bastion host (reachable from the server). */
    host: z.string().min(1),
    /** SSH port (default 22). */
    port: z.number().int().min(1).max(65535).optional(),
    /** SSH username. */
    user: z.string().min(1),
    /** Password auth (or a `${secret:KEY}` token). Omit when using a private key. */
    password: z.string().optional(),
    /** Private-key PEM (or a `${secret:KEY}` token). */
    privateKey: z.string().optional(),
    /** Passphrase for an encrypted private key (or a `${secret:KEY}` token). */
    passphrase: z.string().optional(),
    /**
     * The bastion's host key, pinned on first successful connect (`SHA256:<base64>`, the form
     * `ssh-keygen -lf` prints). Every later connect must present the same key — without it,
     * anyone on the path to the bastion could stand in for it and receive the SSH password
     * and every byte of database traffic. See `ssh-host-key.ts`.
     */
    hostKeyFingerprint: z
      .string()
      .regex(/^SHA256:[A-Za-z0-9+/]{43}$/, 'Not an SSH SHA256 host key fingerprint.')
      .optional(),
  })
  .superRefine((ssh, ctx) => {
    const hasPassword = !!ssh.password
    const hasPrivateKey = !!ssh.privateKey?.trim()
    if (!hasPassword && !hasPrivateKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide an SSH password or private key.',
        path: ['password'],
      })
    }
    if (ssh.passphrase && !hasPrivateKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An SSH passphrase requires a private key.',
        path: ['privateKey'],
      })
    }
  })
export type SshTunnelConfig = z.infer<typeof sshTunnelConfigSchema>

/**
 * Fields a NETWORK dialect config shares. A connection is described EITHER by a single
 * `url` OR by discrete `host`/`port`/`user`/`password`/`database` fields (+ optional
 * `ssl`); the union's refine below requires at least one of `url`/`host`. `password` may
 * itself carry a `${secret:KEY}` token (resolved server-side at connect time), so a
 * vaulted credential works in field mode too. An optional `ssh` block tunnels the whole
 * connection through a bastion (see {@link sshTunnelConfigSchema}).
 */
const networkConnectionFields = {
  /** Full connection URL (e.g. `postgres://user:pass@host:5432/db`). Optional when discrete fields are given. */
  url: z.string().min(1).optional(),
  /** Host name / IP. Optional when a `url` is given. */
  host: z.string().min(1).optional(),
  /** TCP port. */
  port: z.number().int().min(1).max(65535).optional(),
  /** Username. */
  user: z.string().optional(),
  /** Password (may be a `${secret:KEY}` token). */
  password: z.string().optional(),
  /** Database / schema name (Redis: the numeric DB index as a string). */
  database: z.string().optional(),
  /** TLS/SSL options. */
  ssl: sslSchema.optional(),
  /** Optional SSH tunnel through a bastion host. */
  ssh: sshTunnelConfigSchema.optional(),
  ...baseConnectionFields,
}

/** Connection configs, discriminated by dialect — one schema per engine in the driver catalog. */
export const sqliteConnectionSchema = z.object({
  dialect: z.literal('sqlite'),
  /** Absolute path to the .db/.sqlite file, or ':memory:'. */
  file: z.string().min(1),
  ...baseConnectionFields,
})

export const postgresConnectionSchema = z.object({
  dialect: z.literal('postgres'),
  ...networkConnectionFields,
})

export const mysqlConnectionSchema = z.object({
  dialect: z.literal('mysql'),
  ...networkConnectionFields,
})

export const mssqlConnectionSchema = z.object({
  dialect: z.literal('mssql'),
  ...networkConnectionFields,
})

export const clickhouseConnectionSchema = z.object({
  dialect: z.literal('clickhouse'),
  ...networkConnectionFields,
})

/** Redis (engine kind 'kv') — a `redis://` / `rediss://` URL or discrete fields. Not a SQL
 *  engine: its console runs Redis commands, not SQL. */
export const redisConnectionSchema = z.object({
  dialect: z.literal('redis'),
  ...networkConnectionFields,
})

/** MongoDB (engine kind 'document') — a `mongodb://` / `mongodb+srv://` URL or discrete fields.
 *  Not SQL: its console runs `db.<collection>.<method>(...)` shell-style queries. */
export const mongoConnectionSchema = z.object({
  dialect: z.literal('mongodb'),
  ...networkConnectionFields,
})

/** Elasticsearch (engine kind 'search') — an `http(s)://` node URL or discrete fields. Not SQL:
 *  its console runs `<index>.<method>(...)` Query-DSL searches. */
export const esConnectionSchema = z.object({
  dialect: z.literal('elasticsearch'),
  ...networkConnectionFields,
})

/** A network dialect config must describe its target EITHER by `url` OR by `host`. */
const URL_SCHEME_RE = /^([a-zA-Z][\w+.-]*):\/\//

function refineNetworkTarget(
  cfg: {
    dialect: DbDialect
    url?: string
    host?: string
    port?: number
    user?: string
    password?: string
    database?: string
  },
  ctx: z.RefinementCtx,
) {
  if (isFileDatabaseDialect(cfg.dialect)) return
  if (!cfg.url && !cfg.host) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide a connection URL, or a host (with optional port/user/password/database).',
      path: ['host'],
    })
  }
  if (
    cfg.url &&
    [cfg.host, cfg.port, cfg.user, cfg.password, cfg.database].some((value) => value !== undefined)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'Provide either a connection URL or discrete host/port/user/password/database fields, not both.',
      path: ['url'],
    })
  }
  if (cfg.url) {
    const url = cfg.url.trim()
    const scheme = URL_SCHEME_RE.exec(url)?.[1]?.toLowerCase()
    const manifest = getDatabaseDriverManifest(cfg.dialect)
    const accepted =
      scheme !== undefined
        ? manifest.urlSchemes.includes(scheme)
        : cfg.dialect === 'mssql' && isMssqlAdoConnectionString(url)
    if (!accepted) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          cfg.dialect === 'mssql'
            ? `SQL Server expects ${manifest.urlSchemes.join(':// or ')}://, or an ADO connection string with Server/Data Source.`
            : `${manifest.label} expects ${manifest.urlSchemes.map((item) => `${item}://`).join(' or ')}`,
        path: ['url'],
      })
    }
  }
  if (cfg.dialect === 'redis' && cfg.database !== undefined) {
    const database = cfg.database.trim()
    const parsed = Number(database)
    if (database && (!/^\d+$/.test(database) || !Number.isSafeInteger(parsed))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Redis database must be a non-negative integer.',
        path: ['database'],
      })
    }
  }
}

export const dbConnectionConfigSchema = z
  .discriminatedUnion('dialect', [
    sqliteConnectionSchema,
    postgresConnectionSchema,
    mysqlConnectionSchema,
    mssqlConnectionSchema,
    clickhouseConnectionSchema,
    redisConnectionSchema,
    mongoConnectionSchema,
    esConnectionSchema,
  ])
  .superRefine(refineNetworkTarget)
export type DbConnectionConfig = z.infer<typeof dbConnectionConfigSchema>

export type FileDbConnectionConfig = Extract<DbConnectionConfig, { dialect: 'sqlite' }>
export type NetworkDbConnectionConfig = Exclude<DbConnectionConfig, FileDbConnectionConfig>

export function isFileConnectionConfig(
  config: DbConnectionConfig,
): config is FileDbConnectionConfig {
  return isFileDatabaseDialect(config.dialect)
}

export function isNetworkConnectionConfig(
  config: DbConnectionConfig,
): config is NetworkDbConnectionConfig {
  return isNetworkDatabaseDialect(config.dialect)
}
