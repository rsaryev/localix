import { describe, expect, test } from 'bun:test'
import {
  buildConnectionConfig,
  initialFields,
  parseConnectionUrl,
  portAfterTlsToggle,
  tlsClientIdentityIssue,
  vaultSecrets,
} from './model'
import { sshTunnelIssue } from './useSshTunnel'

describe('connection URL import', () => {
  test('fills the editable fields for a compatible manifest', () => {
    expect(
      parseConnectionUrl('postgres://ada:s3cret@db.internal:6432/app?sslmode=require', 'postgres'),
    ).toMatchObject({
      host: 'db.internal',
      port: '6432',
      user: 'ada',
      password: 's3cret',
      database: 'app',
      tls: true,
    })
  })

  test('uses manifest defaults and rejects the wrong engine scheme', () => {
    expect(parseConnectionUrl('mysql://root@localhost/app', 'mysql').port).toBe('3306')
    expect(
      parseConnectionUrl('clickhouse://reader@analytics.internal/default', 'clickhouse').port,
    ).toBe('8123')
    expect(
      parseConnectionUrl('clickhouses://reader@analytics.internal/default', 'clickhouse').port,
    ).toBe('8443')
    expect(() => parseConnectionUrl('redis://localhost', 'postgres')).toThrow(/PostgreSQL expects/)
  })

  test('moves only protocol-default ClickHouse ports when TLS changes', () => {
    expect(portAfterTlsToggle('clickhouse', '8123', true)).toBe('8443')
    expect(portAfterTlsToggle('clickhouse', '8443', false)).toBe('8123')
    expect(portAfterTlsToggle('clickhouse', '9443', true)).toBe('9443')
    expect(portAfterTlsToggle('postgres', '5432', true)).toBe('5432')
  })

  test('hydrates a TLS override stored beside a connection URL', () => {
    expect(
      initialFields({
        dialect: 'postgres',
        url: 'postgres://reader@db.internal/app',
        ssl: {
          rejectUnauthorized: false,
          ca: 'CA PEM',
          cert: 'CERT PEM',
          key: 'KEY PEM',
        },
      }),
    ).toMatchObject({
      host: 'db.internal',
      port: '5432',
      tls: true,
      adv: {
        rejectUnauthorized: false,
        ca: 'CA PEM',
        cert: 'CERT PEM',
        key: 'KEY PEM',
      },
      importUrl: 'postgres://reader@db.internal/app',
    })
    expect(
      initialFields({
        dialect: 'postgres',
        url: 'postgres://reader@db.internal/app?sslmode=require',
        ssl: false,
      }).tls,
    ).toBe(false)
  })
})

describe('connection config assembly', () => {
  const base = {
    dialect: 'sqlite' as const,
    targetMode: 'file' as const,
    file: '',
    host: '',
    port: '',
    user: '',
    password: '',
    database: '',
    readonly: false,
  }

  test('uses the manifest-driven path for SQLite memory targets', () => {
    expect(buildConnectionConfig({ ...base, targetMode: 'memory' })).toEqual({
      dialect: 'sqlite',
      file: ':memory:',
    })
  })

  test('assembles every network driver into the same public field shape', () => {
    expect(
      buildConnectionConfig({
        ...base,
        dialect: 'clickhouse',
        host: 'analytics.internal',
        port: '8443',
        user: 'default',
        password: 'secret',
        database: 'events',
        ssl: true,
      }),
    ).toEqual({
      dialect: 'clickhouse',
      host: 'analytics.internal',
      port: 8443,
      user: 'default',
      password: 'secret',
      database: 'events',
      ssl: true,
    })
  })
})

describe('TLS client identity validation', () => {
  const advanced = {
    rejectUnauthorized: true,
    ca: '',
    cert: '',
    key: '',
  }

  test('requires certificate and key together only when TLS is enabled', () => {
    expect(tlsClientIdentityIssue(true, advanced)).toBeNull()
    expect(
      tlsClientIdentityIssue(true, { ...advanced, cert: 'CERT PEM', key: 'KEY PEM' }),
    ).toBeNull()
    expect(tlsClientIdentityIssue(true, { ...advanced, cert: 'CERT PEM' })).toBe(
      'Client certificate and key are both required.',
    )
    expect(tlsClientIdentityIssue(true, { ...advanced, key: 'KEY PEM' })).toBe(
      'Client certificate and key are both required.',
    )
    expect(tlsClientIdentityIssue(false, { ...advanced, cert: 'unused' })).toBeNull()
  })
})

describe('SSH tunnel validation', () => {
  const complete = {
    enabled: true,
    supported: true,
    host: 'bastion.internal',
    port: '22',
    user: 'tunnel',
    auth: 'password' as const,
    password: 'secret',
    privateKey: '',
  }

  test('accepts a complete tunnel and ignores disabled or unsupported tunnels', () => {
    expect(sshTunnelIssue(complete)).toBeNull()
    expect(
      sshTunnelIssue({ ...complete, enabled: false, host: '', user: '', password: '' }),
    ).toBeNull()
    expect(
      sshTunnelIssue({ ...complete, supported: false, host: '', user: '', password: '' }),
    ).toBeNull()
  })

  test('rejects incomplete connection and authentication fields', () => {
    expect(sshTunnelIssue({ ...complete, host: '' })).toBe('SSH host is required.')
    expect(sshTunnelIssue({ ...complete, port: '70000' })).toBe(
      'SSH port must be between 1 and 65535.',
    )
    expect(sshTunnelIssue({ ...complete, user: '' })).toBe('SSH user is required.')
    expect(sshTunnelIssue({ ...complete, password: '' })).toBe('SSH password is required.')
    expect(
      sshTunnelIssue({
        ...complete,
        auth: 'key',
        password: '',
        privateKey: '',
      }),
    ).toBe('SSH private key is required.')
  })
})

describe('connection credential vaulting', () => {
  test('replaces a raw SSH private key and passphrase with Vault tokens', async () => {
    const writes: Array<{ key: string; value: string }> = []
    const config = {
      dialect: 'postgres' as const,
      host: 'db.internal',
      ssh: {
        host: 'bastion.internal',
        user: 'tunnel',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nraw-key',
        passphrase: 'key-passphrase',
      },
    }

    const vaulted = await vaultSecrets(
      config,
      {
        vaultPassword: false,
        passwordInFields: true,
        vaultSsh: true,
        vaultTlsKey: false,
      },
      async (request) => {
        writes.push(request)
      },
    )

    expect(writes).toEqual([
      {
        key: 'SSH_BASTION_INTERNAL_PRIVATE_KEY',
        value: '-----BEGIN OPENSSH PRIVATE KEY-----\nraw-key',
      },
      { key: 'SSH_BASTION_INTERNAL_PASSPHRASE', value: 'key-passphrase' },
    ])
    expect(vaulted).toEqual({
      ...config,
      ssh: {
        ...config.ssh,
        privateKey: '${secret:SSH_BASTION_INTERNAL_PRIVATE_KEY}',
        passphrase: '${secret:SSH_BASTION_INTERNAL_PASSPHRASE}',
      },
    })
  })

  test('replaces a raw TLS client private key with a Vault token', async () => {
    const writes: Array<{ key: string; value: string }> = []
    const config = {
      dialect: 'postgres' as const,
      host: 'db.internal',
      ssl: {
        cert: '-----BEGIN CERTIFICATE-----\npublic-cert',
        key: '-----BEGIN PRIVATE KEY-----\nraw-key',
      },
    }

    const vaulted = await vaultSecrets(
      config,
      {
        vaultPassword: false,
        passwordInFields: true,
        vaultSsh: false,
        vaultTlsKey: true,
      },
      async (request) => {
        writes.push(request)
      },
    )

    expect(writes).toEqual([
      {
        key: 'DB_DB_INTERNAL_TLS_PRIVATE_KEY',
        value: '-----BEGIN PRIVATE KEY-----\nraw-key',
      },
    ])
    expect(vaulted).toEqual({
      ...config,
      ssl: {
        ...config.ssl,
        key: '${secret:DB_DB_INTERNAL_TLS_PRIVATE_KEY}',
      },
    })
  })

  test('does not vault an existing token embedded in a connection URL again', async () => {
    const writes: Array<{ key: string; value: string }> = []
    const config = {
      dialect: 'postgres' as const,
      url: 'postgres://app:${secret:DB_PW}@db.internal/app',
    }

    expect(
      await vaultSecrets(
        config,
        {
          vaultPassword: true,
          passwordInFields: false,
          vaultSsh: false,
          vaultTlsKey: false,
        },
        async (request) => {
          writes.push(request)
        },
      ),
    ).toEqual(config)
    expect(writes).toEqual([])
  })
})
