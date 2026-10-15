import {
  DATABASE_DIALECTS,
  DATABASE_DRIVERS,
  DATABASE_DRIVER_CATALOG,
  type DbDialect,
  type EngineKind,
} from '../../shared/driver-catalog'

/** Engine family per dialect (static — always known, even for a disconnected connection,
 *  unlike the live driver's `flags.kind`). Drives whether the SQL console or a kind-specific
 *  surface (Redis command console) is shown. Mirrors the drivers' reported `DriverFlags.kind`. */
export const DIALECT_KIND = Object.fromEntries(
  DATABASE_DRIVERS.map((driver) => [driver.id, driver.kind]),
) as Record<DbDialect, EngineKind>

/** Human labels + a stable display order for every supported engine. Shared by
 *  the connection list (grouped by dialect) and the connect form's engine picker. */
export const DIALECT_LABEL = Object.fromEntries(
  DATABASE_DRIVERS.map((driver) => [driver.id, driver.label]),
) as Record<DbDialect, string>

/** Per-engine picker metadata: a short 2-letter badge + a static (Tailwind-safe) tint pair,
 *  so the connect form can show distinct engine cards without brand-SVG assets or CDN icons. */
export interface DialectMeta {
  id: DbDialect
  label: string
  /** 2-char badge glyph. */
  badge: string
  /** Static Tailwind classes for the badge (bg + text), theme-aware. */
  tint: string
  /** Text-only tint (no fill) — the calmer badge treatment in the connect form. */
  tintText: string
}

/**
 * An engine's accent is IDENTITY colour, so it comes from the `--conn-*` token family (the same
 * one a connection's colour tag uses) rather than a raw Tailwind palette step: the tokens are
 * already tuned per theme, which is what retires the `dark:` fork each pair used to carry.
 * `yellow` folds onto `conn-amber` — the nearest token, and the two read alike at badge size.
 */
const DIALECT_TINT: Record<
  (typeof DATABASE_DRIVER_CATALOG)[DbDialect]['accent'],
  Pick<DialectMeta, 'tint' | 'tintText'>
> = {
  sky: { tint: 'bg-conn-blue/15 text-conn-blue', tintText: 'text-conn-blue' },
  indigo: { tint: 'bg-conn-violet/15 text-conn-violet', tintText: 'text-conn-violet' },
  amber: { tint: 'bg-conn-amber/15 text-conn-amber', tintText: 'text-conn-amber' },
  red: { tint: 'bg-conn-red/15 text-conn-red', tintText: 'text-conn-red' },
  rose: { tint: 'bg-conn-pink/15 text-conn-pink', tintText: 'text-conn-pink' },
  green: { tint: 'bg-conn-green/15 text-conn-green', tintText: 'text-conn-green' },
  yellow: { tint: 'bg-conn-amber/15 text-conn-amber', tintText: 'text-conn-amber' },
}

export const DIALECT_META: Record<DbDialect, Omit<DialectMeta, 'id' | 'label'>> = {
  sqlite: {
    badge: DATABASE_DRIVER_CATALOG.sqlite.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.sqlite.accent],
  },
  postgres: {
    badge: DATABASE_DRIVER_CATALOG.postgres.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.postgres.accent],
  },
  mysql: {
    badge: DATABASE_DRIVER_CATALOG.mysql.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.mysql.accent],
  },
  mssql: {
    badge: DATABASE_DRIVER_CATALOG.mssql.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.mssql.accent],
  },
  clickhouse: {
    badge: DATABASE_DRIVER_CATALOG.clickhouse.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.clickhouse.accent],
  },
  redis: {
    badge: DATABASE_DRIVER_CATALOG.redis.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.redis.accent],
  },
  mongodb: {
    badge: DATABASE_DRIVER_CATALOG.mongodb.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.mongodb.accent],
  },
  elasticsearch: {
    badge: DATABASE_DRIVER_CATALOG.elasticsearch.shortLabel,
    ...DIALECT_TINT[DATABASE_DRIVER_CATALOG.elasticsearch.accent],
  },
}

/** Ordered engine list for the connect form's engine picker (id + label + badge + tint). */
export const DIALECTS: DialectMeta[] = DATABASE_DIALECTS.map((id) => ({
  id,
  label: DIALECT_LABEL[id],
  ...DIALECT_META[id],
}))

export { DATABASE_DRIVER_CATALOG, DATABASE_DRIVERS }
