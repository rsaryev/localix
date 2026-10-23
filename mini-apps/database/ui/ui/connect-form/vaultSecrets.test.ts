import { expect, test } from 'bun:test'

import { vaultSecrets } from './model'

test('a rejected TLS vault write stops later SSH writes without mutating the input', async () => {
  const config = {
    dialect: 'postgres' as const,
    host: 'db.internal',
    password: 'database-password',
    ssl: { cert: 'certificate', key: 'tls-key' },
    ssh: { host: 'bastion.internal', user: 'tunnel', password: 'ssh-password' },
  }
  const before = structuredClone(config)
  const writes: Array<{ key: string; value: string }> = []
  const failure = new Error('Vault unavailable')
  let thrown: unknown
  try {
    await vaultSecrets(
      config,
      { vaultPassword: true, passwordInFields: true, vaultTlsKey: true, vaultSsh: true },
      async (request) => {
        writes.push(request)
        if (request.value === 'tls-key') throw failure
      },
    )
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBe(failure)
  expect(writes.map((request) => request.value)).toEqual(['database-password', 'tls-key'])
  expect(config).toEqual(before)
})
