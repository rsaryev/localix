/** Driver factory: connection config → concrete {@link DbDriver}. */
import type { DbConnectionConfig } from '../contracts'
import type { DbDriver } from './port'
import { toDriverInput } from './connection-input'
import {
  DATABASE_DRIVER_CATALOG,
  type DatabaseDriverManifest,
  type DbDialect,
} from '../../shared/driver-catalog'

type ConfigFor<Dialect extends DbDialect> = Extract<DbConnectionConfig, { dialect: Dialect }>

export interface DatabaseDriverDefinition<Dialect extends DbDialect = DbDialect> {
  manifest: DatabaseDriverManifest & { id: Dialect }
  /**
   * ASYNC because the client library is imported here, not at module load.
   *
   * Importing all eight eagerly cost a measured **120 ms of every API boot** — a
   * third of it — for connections most sessions never open. The mini app ships
   * `defaultEnabled: true`, and a bundled mini app defaults on per project scope,
   * so that price was paid by users who had switched the mini app off globally.
   * Per-module cost: mssql 76 ms, elasticsearch 69, mongo 41, mysql 21,
   * clickhouse 15, postgres 7, redis and sqlite 1 each.
   *
   * The manifest half stays eager on purpose: it is pure data from the shared
   * catalog, it is what the UI lists, and it must not drag a client library in.
   */
  create(config: ConfigFor<Dialect>): Promise<DbDriver>
}

/**
 * The executable half of the shared driver catalog. A new engine must provide exactly
 * one definition here; TypeScript then requires catalog/config/adapter coverage before
 * the registry can compile. Callers never switch on dialect.
 */
export const DATABASE_DRIVER_REGISTRY = {
  sqlite: {
    manifest: DATABASE_DRIVER_CATALOG.sqlite,
    create: async (config) =>
      (await import('./sqlite')).createSqliteDriver({
        file: config.file,
        readonly: config.readonly,
      }),
  },
  postgres: {
    manifest: DATABASE_DRIVER_CATALOG.postgres,
    create: async (config) =>
      (await import('./postgres')).createPostgresDriver(toDriverInput(config)),
  },
  mysql: {
    manifest: DATABASE_DRIVER_CATALOG.mysql,
    create: async (config) =>
      (await import('./mysql')).createMysqlDriver({
        ...toDriverInput(config),
        readonly: config.readonly,
      }),
  },
  mssql: {
    manifest: DATABASE_DRIVER_CATALOG.mssql,
    create: async (config) => (await import('./mssql')).createMssqlDriver(toDriverInput(config)),
  },
  clickhouse: {
    manifest: DATABASE_DRIVER_CATALOG.clickhouse,
    create: async (config) =>
      (await import('./clickhouse')).createClickHouseDriver(toDriverInput(config)),
  },
  redis: {
    manifest: DATABASE_DRIVER_CATALOG.redis,
    create: async (config) => (await import('./redis')).createRedisDriver(toDriverInput(config)),
  },
  mongodb: {
    manifest: DATABASE_DRIVER_CATALOG.mongodb,
    create: async (config) => (await import('./mongo')).createMongoDriver(toDriverInput(config)),
  },
  elasticsearch: {
    manifest: DATABASE_DRIVER_CATALOG.elasticsearch,
    create: async (config) => (await import('./es')).createEsDriver(toDriverInput(config)),
  },
} satisfies { [Dialect in DbDialect]: DatabaseDriverDefinition<Dialect> }

export function getDriverDefinition(dialect: DbDialect): DatabaseDriverDefinition {
  return DATABASE_DRIVER_REGISTRY[dialect] as DatabaseDriverDefinition
}

export function createDriver(config: DbConnectionConfig): Promise<DbDriver> {
  return getDriverDefinition(config.dialect).create(config)
}

export * from './port'
