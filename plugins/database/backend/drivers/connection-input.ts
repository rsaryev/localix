/**
 * Agnostic normalizer between a stored {@link DbConnectionConfig} and the shape a network
 * driver consumes. A connection is described EITHER by a single `url` OR by discrete
 * `host`/`port`/`user`/`password`/`database` fields (+ `ssl`). This module carries NO
 * lib-specific mapping — each driver takes a {@link DriverConnInput} and maps `url`-vs-fields
 * (and the `ssl` shape) onto its own client's native connection options.
 */
import { isFileConnectionConfig, type DbConnectionConfig, type DbSslConfig } from '../contracts'

/** The union of connection descriptors a network driver accepts. */
export interface DriverConnInput {
  /** Full connection URL — when present a driver uses it verbatim (unchanged behaviour). */
  url?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: DbSslConfig
}

/** Pull the driver-facing connection input out of a (non-sqlite) config. */
export function toDriverInput(config: DbConnectionConfig): DriverConnInput {
  if (isFileConnectionConfig(config)) {
    // File databases are not network targets; callers never route them here.
    return {}
  }
  return {
    url: config.url,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
  }
}
