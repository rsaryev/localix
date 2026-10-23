import { describe, expect, it } from 'bun:test'
import { dbConnectionConfigSchema } from './connection-config'

describe('network connection config validation', () => {
  it('accepts only real TCP ports', () => {
    expect(
      dbConnectionConfigSchema.safeParse({
        dialect: 'postgres',
        host: 'db.internal',
        port: 65535,
      }).success,
    ).toBe(true)
    expect(
      dbConnectionConfigSchema.safeParse({
        dialect: 'postgres',
        host: 'db.internal',
        port: 65536,
      }).success,
    ).toBe(false)
  })

  it('rejects a Redis database that would otherwise fall back silently to DB 0', () => {
    for (const database of ['0', '15', ' 42 ']) {
      expect(
        dbConnectionConfigSchema.safeParse({
          dialect: 'redis',
          host: 'cache.internal',
          database,
        }).success,
      ).toBe(true)
    }
    for (const database of ['-1', '1.5', 'not-a-database', '9007199254740992']) {
      expect(
        dbConnectionConfigSchema.safeParse({
          dialect: 'redis',
          host: 'cache.internal',
          database,
        }).success,
      ).toBe(false)
    }
  })

  it('requires a supported SSH credential and pairs a passphrase with a private key', () => {
    const base = {
      dialect: 'postgres' as const,
      host: 'db.internal',
      ssh: { host: 'bastion.internal', user: 'tunnel' },
    }
    expect(dbConnectionConfigSchema.safeParse(base).success).toBe(false)
    expect(
      dbConnectionConfigSchema.safeParse({
        ...base,
        ssh: { ...base.ssh, password: '${secret:SSH_PASSWORD}' },
      }).success,
    ).toBe(true)
    expect(
      dbConnectionConfigSchema.safeParse({
        ...base,
        ssh: { ...base.ssh, privateKey: '${secret:SSH_PRIVATE_KEY}', passphrase: 'secret' },
      }).success,
    ).toBe(true)
    expect(
      dbConnectionConfigSchema.safeParse({
        ...base,
        ssh: { ...base.ssh, passphrase: 'unused' },
      }).success,
    ).toBe(false)
  })

  it('rejects target fields that a connection URL would silently override', () => {
    const base = {
      dialect: 'postgres' as const,
      url: 'postgres://app:pw@db.internal:5432/app',
    }

    expect(dbConnectionConfigSchema.safeParse(base).success).toBe(true)
    expect(
      dbConnectionConfigSchema.safeParse({
        ...base,
        ssl: { rejectUnauthorized: true },
        ssh: { host: 'bastion.internal', user: 'tunnel', password: 'pw' },
      }).success,
    ).toBe(true)
    for (const field of [
      { host: 'other' },
      { port: 5433 },
      { user: 'other' },
      { password: 'other' },
      { database: 'other' },
    ]) {
      const result = dbConnectionConfigSchema.safeParse({ ...base, ...field })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === 'url')).toBe(true)
      }
    }
  })

  it('requires a complete TLS client identity while allowing a custom CA alone', () => {
    const base = { dialect: 'postgres' as const, host: 'db.internal' }

    expect(dbConnectionConfigSchema.safeParse({ ...base, ssl: { ca: 'CA PEM' } }).success).toBe(
      true,
    )
    expect(
      dbConnectionConfigSchema.safeParse({
        ...base,
        ssl: { cert: 'CERT PEM', key: '${secret:TLS_KEY}' },
      }).success,
    ).toBe(true)
    expect(dbConnectionConfigSchema.safeParse({ ...base, ssl: { cert: 'CERT PEM' } }).success).toBe(
      false,
    )
    expect(dbConnectionConfigSchema.safeParse({ ...base, ssl: { key: 'KEY PEM' } }).success).toBe(
      false,
    )
  })

  it('accepts only manifest URL schemes, with SQL Server ADO as the explicit exception', () => {
    const valid = [
      { dialect: 'postgres', url: 'postgresql://db.internal/app' },
      { dialect: 'mysql', url: 'mysql://db.internal/app' },
      { dialect: 'clickhouse', url: 'https://analytics.internal/default' },
      { dialect: 'redis', url: 'rediss://cache.internal/0' },
      { dialect: 'mongodb', url: 'mongodb+srv://cluster.example/app' },
      { dialect: 'elasticsearch', url: 'http://search.internal:9200' },
      {
        dialect: 'mssql',
        url: 'Server=db.internal,1433;Database=app;User Id=sa;Password=pw',
      },
      {
        dialect: 'mssql',
        url: 'Data Source={db.internal;instance};Database=app;Integrated Security=true',
      },
    ]
    for (const config of valid) {
      expect(dbConnectionConfigSchema.safeParse(config).success).toBe(true)
    }

    for (const config of [
      { dialect: 'postgres', url: 'redis://cache.internal' },
      { dialect: 'elasticsearch', url: 'ftp://search.internal' },
      { dialect: 'mongodb', url: 'not-a-url' },
      { dialect: 'mssql', url: 'arbitrary text' },
      { dialect: 'mssql', url: 'Password={secret;Server=fake};Database=app' },
      { dialect: 'mssql', url: 'Server=db.internal;Password={unfinished' },
    ]) {
      const result = dbConnectionConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === 'url')).toBe(true)
      }
    }
  })
})
