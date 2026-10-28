import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DbConnectionConfig, SshTunnelConfig } from './contracts'
import type { DbDriver } from './drivers/port'
import { DbError } from './errors'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'
import {
  mapSshError,
  rewriteConfigForTunnel,
  type TunnelHandle,
  tunnelTargetFor,
} from './ssh-tunnel'

describe('tunnelTargetFor (URL → DB endpoint)', () => {
  it('reads host + explicit port from the connection URL', () => {
    expect(
      tunnelTargetFor({ dialect: 'postgres', url: 'postgres://u:p@db.internal:6001/app' }),
    ).toEqual({
      host: 'db.internal',
      port: 6001,
    })
  })

  it('falls back to the per-dialect default port when the URL omits one', () => {
    const cases: Array<[DbConnectionConfig, number]> = [
      [{ dialect: 'postgres', url: 'postgres://u@h/app' }, 5432],
      [{ dialect: 'mysql', url: 'mysql://u@h/app' }, 3306],
      [{ dialect: 'mssql', url: 'mssql://u@h/app' }, 1433],
      [{ dialect: 'redis', url: 'redis://h' }, 6379],
      [{ dialect: 'mongodb', url: 'mongodb://h/app' }, 27017],
      [{ dialect: 'elasticsearch', url: 'http://h/' }, 9200],
      [{ dialect: 'clickhouse', url: 'clickhouse://h/default' }, 8123],
      [{ dialect: 'clickhouse', url: 'clickhouses://h/default' }, 8443],
    ]
    for (const [config, port] of cases) {
      expect(tunnelTargetFor(config)).toEqual({ host: 'h', port })
    }
  })

  it('reads host + port from discrete FIELDS when there is no url', () => {
    expect(tunnelTargetFor({ dialect: 'postgres', host: 'db.internal', port: 6001 })).toEqual({
      host: 'db.internal',
      port: 6001,
    })
    // Field mode with no port falls back to the dialect default.
    expect(tunnelTargetFor({ dialect: 'mysql', host: 'db.internal' })).toEqual({
      host: 'db.internal',
      port: 3306,
    })
    expect(
      tunnelTargetFor({ dialect: 'clickhouse', host: 'analytics.internal', ssl: true }),
    ).toEqual({
      host: 'analytics.internal',
      port: 8443,
    })
  })

  it('uses a separate URL TLS override when selecting the default tunnel target port', () => {
    expect(
      tunnelTargetFor({
        dialect: 'clickhouse',
        url: 'clickhouse://analytics.internal/default',
        ssl: true,
      }),
    ).toEqual({ host: 'analytics.internal', port: 8443 })
    expect(
      tunnelTargetFor({
        dialect: 'clickhouse',
        url: 'clickhouses://analytics.internal/default',
        ssl: false,
      }),
    ).toEqual({ host: 'analytics.internal', port: 8123 })
  })

  it('rejects sqlite, a hostless config, and mongodb+srv with ssh_failed', () => {
    expect(() => tunnelTargetFor({ dialect: 'sqlite', file: '/x.db' })).toThrow(DbError)
    expect(() =>
      tunnelTargetFor({ dialect: 'mongodb', url: 'mongodb+srv://cluster.example/app' }),
    ).toThrow(/mongodb\+srv/)
    expect(() => tunnelTargetFor({ dialect: 'postgres', url: 'not a url' })).toThrow(DbError)
    expect(() => tunnelTargetFor({ dialect: 'postgres' })).toThrow(DbError)
  })
})

describe('rewriteConfigForTunnel (driver input rewrite)', () => {
  it('repoints host+port at the local end, preserves creds/db/query, and drops ssh', () => {
    const config: DbConnectionConfig = {
      dialect: 'postgres',
      url: 'postgres://alice:secretpw@db.internal:5432/app?sslmode=require',
      readonly: true,
      ssh: { host: 'bastion', user: 'tunnel', password: 'p' },
    }
    const out = rewriteConfigForTunnel(config, '127.0.0.1', 54999)
    expect(out.dialect).toBe('postgres')
    if ('file' in out) throw new Error('unreachable')
    // Host + port swapped to the local forwarded end.
    expect(out.url).toContain('@127.0.0.1:54999/app')
    // Credentials, database, and query string preserved.
    expect(out.url).toContain('alice:secretpw@')
    expect(out.url).toContain('sslmode=require')
    // Metadata kept, ssh block removed (the driver never sees it).
    expect(out.readonly).toBe(true)
    expect('ssh' in out).toBe(false)
  })

  it('repoints discrete host/port in FIELDS mode, keeping user/password/database/ssl, drops ssh', () => {
    const config: DbConnectionConfig = {
      dialect: 'postgres',
      host: 'db.internal',
      port: 5432,
      user: 'alice',
      password: 'secretpw',
      database: 'app',
      ssl: true,
      ssh: { host: 'bastion', user: 'tunnel', password: 'p' },
    }
    const out = rewriteConfigForTunnel(config, '127.0.0.1', 54999)
    if ('file' in out) throw new Error('unreachable')
    expect(out.host).toBe('127.0.0.1')
    expect(out.port).toBe(54999)
    expect(out.user).toBe('alice')
    expect(out.password).toBe('secretpw')
    expect(out.database).toBe('app')
    expect(out.ssl).toBe(true)
    expect('ssh' in out).toBe(false)
    // No spurious url in fields mode.
    expect(out.url).toBeUndefined()
  })

  it('leaves a sqlite config untouched (no url to rewrite)', () => {
    const config: DbConnectionConfig = { dialect: 'sqlite', file: '/tmp/x.db' }
    expect(rewriteConfigForTunnel(config, '127.0.0.1', 1)).toBe(config)
  })
})

describe('mapSshError', () => {
  it('classifies auth failures distinctly and always yields ssh_failed', () => {
    const auth = mapSshError(new Error('All configured authentication methods failed'))
    expect(auth.code).toBe('ssh_failed')
    expect(auth.message).toMatch(/authentication failed/i)

    const connect = mapSshError(new Error('connect ECONNREFUSED 127.0.0.1:22'))
    expect(connect.code).toBe('ssh_failed')
    expect(connect.message).toMatch(/SSH host/i)
  })
})

describe('establish through an SSH tunnel (secret resolution + rewrite, no socket I/O)', () => {
  let dir: string
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  // The URL the driver was pointed at is captured by `createDriver` below (the seam that
  // actually sees the rewritten config) — this fake only has to be a valid DbDriver.
  function makeFakeDriver(): DbDriver {
    return {
      getFlags: () => ({
        dialect: 'postgres',
        kind: 'sql',
        supportsMultipleSchemas: true,
        supportsReturning: true,
        supportsCancel: true,
        defaultSchema: 'public',
      }),
      async query() {
        return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 0 }
      },
      async browse() {
        return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 0 }
      },
      async schemas() {
        return {}
      },
      async tableSchema() {
        return {
          name: 'x',
          type: 'table',
          columns: [],
          primaryKey: [],
          foreignKeys: [],
          indexes: [],
        }
      },
      async close() {},
    }
  }

  it('resolves ${secret:…} in the URL AND ssh creds, then points the driver at the local port', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'localix-ssh-test-'))
    const seenDriverUrl: { url?: string } = {}
    let sawSshTarget: { host: string; port: number } | undefined
    let sawSsh: SshTunnelConfig | undefined
    let tunnelClosed = false

    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      secretsResolver: {
        resolve: async (_userId, key) => {
          if (key === 'DB_PW') return 'db-real-pw'
          if (key === 'SSH_PW') return 'ssh-real-pw'
          throw new Error(`unknown secret ${key}`)
        },
      },
      createDriver: (config) => {
        if (!('file' in config)) seenDriverUrl.url = config.url
        return makeFakeDriver()
      },
      openTunnel: async (ssh, target): Promise<TunnelHandle> => {
        sawSsh = ssh
        sawSshTarget = target
        return {
          localPort: 61234,
          close: async () => {
            tunnelClosed = true
          },
        }
      },
    })

    const conn = await service.connect('u', {
      config: {
        dialect: 'postgres',
        url: 'postgres://alice:${secret:DB_PW}@db.internal:5432/app',
        ssh: { host: 'bastion.example', port: 2200, user: 'tunnel', password: '${secret:SSH_PW}' },
      },
    })

    // Tunnel target parsed from the (resolved) URL, ssh creds resolved from the vault.
    expect(sawSshTarget).toEqual({ host: 'db.internal', port: 5432 })
    expect(sawSsh?.password).toBe('ssh-real-pw')
    expect(sawSsh?.host).toBe('bastion.example')
    expect(sawSsh?.port).toBe(2200)
    // Driver was pointed at the local forwarded port, with the URL password resolved.
    expect(seenDriverUrl.url).toContain('@127.0.0.1:61234/app')
    expect(seenDriverUrl.url).toContain('alice:db-real-pw@')
    // The connection reports it routes through SSH.
    expect(conn.hasSsh).toBe(true)

    // Disconnect closes the tunnel alongside the driver.
    await service.disconnect('u', conn.id)
    expect(tunnelClosed).toBe(true)
  })

  it('resolves independent database and SSH secret fields concurrently', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'localix-secret-concurrency-'))
    let inFlight = 0
    let peak = 0
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      secretsResolver: {
        resolve: async (_userId, key) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          await new Promise((r) => setTimeout(r, 0))
          inFlight -= 1
          return `resolved-${key}`
        },
      },
      createDriver: (config) => {
        if (!('file' in config) && config.ssl && typeof config.ssl === 'object') {
          expect(config.ssl.key).toBe('resolved-TLS_KEY')
        }
        return makeFakeDriver()
      },
      openTunnel: async (): Promise<TunnelHandle> => ({
        localPort: 61234,
        close: async () => {},
      }),
    })

    const conn = await service.connect('u', {
      config: {
        dialect: 'postgres',
        url: 'postgres://alice:${secret:URL}@db.internal:5432/app',
        password: '${secret:DB_PASSWORD}',
        ssl: { key: '${secret:TLS_KEY}' },
        ssh: {
          host: 'bastion.example',
          user: 'tunnel',
          password: '${secret:SSH_PASSWORD}',
          privateKey: '${secret:SSH_KEY}',
          passphrase: '${secret:SSH_PASSPHRASE}',
        },
      },
    })

    expect(peak).toBe(6)
    await service.disconnect('u', conn.id)
  })

  it('releases the tunnel when the driver constructor throws AFTER the tunnel opened', async () => {
    // Crumple-zone harness: openTunnel succeeds (bastion + local listener are up), then the
    // driver factory throws (mirrors mssql's synchronous URL parse in `buildMssqlPoolConfig`).
    // The already-opened tunnel MUST be closed — else the SSH child + listener leak.
    dir = await mkdtemp(path.join(tmpdir(), 'localix-ssh-leak-'))
    let tunnelClosed = false
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver: () => {
        throw new Error('driver constructor blew up after the tunnel opened')
      },
      openTunnel: async (): Promise<TunnelHandle> => ({
        localPort: 61999,
        close: async () => {
          tunnelClosed = true
        },
      }),
    })
    expect(
      service.connect('u', {
        config: {
          dialect: 'postgres',
          url: 'postgres://u@db.internal:5432/app',
          ssh: { host: 'b', user: 't', password: 'p' },
        },
      }),
    ).rejects.toThrow(/driver constructor blew up/)
    // The tunnel opened, so it must have been torn down on the failure path.
    expect(tunnelClosed).toBe(true)
  })

  it('surfaces an SSH open failure as a typed ssh_failed error', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'localix-ssh-fail-'))
    const service = createDatabaseService({
      store: createConnectionStore({ dir: path.join(dir, 'store') }),
      createDriver: () => makeFakeDriver(),
      openTunnel: async () => {
        throw mapSshError(new Error('All configured authentication methods failed'))
      },
    })
    expect(
      service.connect('u', {
        config: {
          dialect: 'postgres',
          url: 'postgres://u@db.internal:5432/app',
          ssh: { host: 'b', user: 't', password: 'wrong' },
        },
      }),
    ).rejects.toMatchObject({ code: 'ssh_failed' })
  })
})
