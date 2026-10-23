import { describe, expect, test } from 'bun:test'
import { configKey, defaultName } from './live-entry'

describe('default connection name', () => {
  test('uses only the file basename on POSIX and Windows paths', () => {
    expect(defaultName({ config: { dialect: 'sqlite', file: '/data/projects/app.sqlite' } })).toBe(
      'app.sqlite',
    )
    expect(
      defaultName({ config: { dialect: 'sqlite', file: String.raw`C:\data\warehouse.sqlite` } }),
    ).toBe('warehouse.sqlite')
  })

  test('keeps explicit and in-memory names', () => {
    expect(
      defaultName({
        name: 'Analytics',
        config: { dialect: 'sqlite', file: String.raw`C:\data\warehouse.sqlite` },
      }),
    ).toBe('Analytics')
    expect(defaultName({ config: { dialect: 'sqlite', file: ':memory:' } })).toBe(
      'In-memory SQLite',
    )
  })
})

describe('connection target identity', () => {
  test('does not treat a rotated URL password as a different target', () => {
    const first = configKey({
      dialect: 'postgres',
      url: 'postgres://app:first@db.internal:5432/app?sslmode=require',
    })
    const rotated = configKey({
      dialect: 'postgres',
      url: 'postgres://app:s%40fer@db.internal:5432/app?sslmode=require',
    })
    const tokenized = configKey({
      dialect: 'postgres',
      url: 'postgres://app:${secret:DB_PW}@db.internal:5432/app?sslmode=require',
    })

    expect(rotated).toBe(first)
    expect(tokenized).toBe(first)
    expect(first).not.toContain('first')
  })

  test('redacts an unescaped at-sign and the rest of the URL password', () => {
    const plain = configKey({
      dialect: 'postgres',
      url: 'postgres://app:first@db.internal:5432/app',
    })
    const withAt = configKey({
      dialect: 'postgres',
      url: 'postgres://app:p@ss@db.internal:5432/app',
    })

    expect(withAt).toBe(plain)
    expect(withAt).not.toContain('p@ss')
  })

  test('keeps username, endpoint, database and query options in the target identity', () => {
    const base = configKey({ dialect: 'postgres', url: 'postgres://app:pw@db.internal/main?x=1' })

    expect(
      configKey({ dialect: 'postgres', url: 'postgres://other:pw@db.internal/main?x=1' }),
    ).not.toBe(base)
    expect(configKey({ dialect: 'postgres', url: 'postgres://app:pw@other/main?x=1' })).not.toBe(
      base,
    )
    expect(
      configKey({ dialect: 'postgres', url: 'postgres://app:pw@db.internal/other?x=1' }),
    ).not.toBe(base)
    expect(
      configKey({ dialect: 'postgres', url: 'postgres://app:pw@db.internal/main?x=2' }),
    ).not.toBe(base)
  })

  test('handles a multi-host MongoDB URI without parsing or exposing its password', () => {
    const key = configKey({
      dialect: 'mongodb',
      url: 'mongodb://app:pw@db-1.internal:27017,db-2.internal:27017/app?replicaSet=rs0',
    })

    expect(key).toBe(
      JSON.stringify([
        'mongodb',
        'url',
        'mongodb://app@db-1.internal:27017,db-2.internal:27017/app?replicaSet=rs0',
        null,
      ]),
    )
    expect(key).not.toContain(':pw@')
  })

  test('does not treat a rotated SQL Server ADO password as a different target', () => {
    const first = configKey({
      dialect: 'mssql',
      url: 'Server=db.internal,1433;Database=app;User Id=sa;Password=first;Encrypt=true',
    })
    const rotated = configKey({
      dialect: 'mssql',
      url: 'Server=db.internal,1433;Database=app;User Id=sa;Password={s;ecret};Encrypt=true',
    })
    const abbreviated = configKey({
      dialect: 'mssql',
      url: 'Server=db.internal,1433;Database=app;User Id=sa;Pwd="t;oken";Encrypt=true',
    })

    expect(rotated).toBe(first)
    expect(abbreviated).toBe(first)
    expect(first).not.toContain('first')
    expect(rotated).not.toContain('s;ecret')
    expect(abbreviated).not.toContain('t;oken')
  })

  test('still strips a SQL Server URI password', () => {
    const key = configKey({
      dialect: 'mssql',
      url: 'sqlserver://sa:pw@db.internal:1433/app?encrypt=true',
    })

    expect(key).toBe(
      JSON.stringify(['mssql', 'url', 'sqlserver://sa@db.internal:1433/app?encrypt=true', null]),
    )
    expect(key).not.toContain(':pw@')
  })

  test('does not collide when field values contain identity delimiters', () => {
    const databaseAt = configKey({
      dialect: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'main@report',
      user: 'reader',
    })
    const userAt = configKey({
      dialect: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'main',
      user: 'report@reader',
    })

    expect(databaseAt).not.toBe(userAt)
  })

  test('keeps SQL Server ADO endpoint, database, username and options in the identity', () => {
    const base = configKey({
      dialect: 'mssql',
      url: 'Server=db.internal;Database=app;User Id=sa;Password=pw;Encrypt=true',
    })

    expect(
      configKey({
        dialect: 'mssql',
        url: 'Server=other;Database=app;User Id=sa;Password=pw;Encrypt=true',
      }),
    ).not.toBe(base)
    expect(
      configKey({
        dialect: 'mssql',
        url: 'Server=db.internal;Database=other;User Id=sa;Password=pw;Encrypt=true',
      }),
    ).not.toBe(base)
    expect(
      configKey({
        dialect: 'mssql',
        url: 'Server=db.internal;Database=app;User Id=other;Password=pw;Encrypt=true',
      }),
    ).not.toBe(base)
    expect(
      configKey({
        dialect: 'mssql',
        url: 'Server=db.internal;Database=app;User Id=sa;Password=pw;Encrypt=false',
      }),
    ).not.toBe(base)
  })

  test('distinguishes private targets reached through different SSH routes', () => {
    const base = {
      dialect: 'postgres' as const,
      host: 'db.internal',
      port: 5432,
      database: 'app',
      user: 'app',
      ssh: { host: 'bastion-a', user: 'tunnel', password: 'first' },
    }
    const key = configKey(base)

    expect(configKey({ ...base, ssh: { ...base.ssh, password: 'rotated' } })).toBe(key)
    expect(
      configKey({ ...base, ssh: { ...base.ssh, privateKey: 'key', password: undefined } }),
    ).toBe(key)
    expect(configKey({ ...base, ssh: { ...base.ssh, port: 22 } })).toBe(key)
    expect(configKey({ ...base, ssh: { ...base.ssh, host: 'bastion-b' } })).not.toBe(key)
    expect(configKey({ ...base, ssh: { ...base.ssh, user: 'other' } })).not.toBe(key)
    expect(configKey({ ...base, ssh: { ...base.ssh, port: 2200 } })).not.toBe(key)
    expect(configKey({ ...base, ssh: undefined })).not.toBe(key)
    expect(key).not.toContain('first')
  })
})
