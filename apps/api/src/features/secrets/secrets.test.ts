import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db'
import { isSecretHandle, toSecretHandle, type CreateSecretRequest } from './contracts'
import { createAesCipher, plaintextCipher } from './cipher'
import { createSecretsStore } from './store'
import { VaultPayloadError } from './store-internals'
import { createSecretsService } from './service'
import { hasSecretTokens, resolveSecretTokens } from '@localixai/mini-app-sdk/backend'

let keyDir: string
const databases: Kysely<AppDatabase>[] = []

beforeAll(async () => {
  keyDir = await mkdtemp(path.join(tmpdir(), 'localix-vault-'))
})

afterAll(async () => {
  await Promise.all(databases.map((db) => destroyDatabase(db)))
  await rm(keyDir, { recursive: true, force: true })
})

async function newStore(
  options: {
    cipher?: typeof plaintextCipher
    now?: () => Date
  } = {},
) {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  return {
    db,
    store: createSecretsStore({
      db,
      keyDir,
      cipher: options.cipher ?? plaintextCipher,
      now: options.now,
    }),
  }
}

const request = (
  key: string,
  value: string,
  patch: Partial<CreateSecretRequest> = {},
): CreateSecretRequest => ({
  key,
  value,
  type: 'secret',
  tags: [],
  ...patch,
})

describe('secret handles', () => {
  it('round-trips a handle', () => {
    expect(toSecretHandle('DB_PASS')).toBe('secret:DB_PASS')
    expect(isSecretHandle('secret:DB_PASS')).toBe(true)
    expect(isSecretHandle('plain')).toBe(false)
  })
})

describe('typed Vault store', () => {
  it('creates, lists metadata only, resolves internally, and deletes', async () => {
    const { store } = await newStore()
    const meta = await store.create(
      'u',
      request('DB_PASS', 's3cret', {
        type: 'database',
        label: 'Production database',
        tags: ['production'],
      }),
    )
    expect(meta).toMatchObject({
      key: 'DB_PASS',
      label: 'Production database',
      type: 'database',
      source: 'user',
      backend: 'local-aes',
      version: 1,
      reference: 'secret:DB_PASS',
      tags: ['production'],
    })

    const list = await store.list('u')
    expect(JSON.stringify(list)).not.toContain('s3cret')
    expect(await store.resolve('u', 'DB_PASS')).toBe('s3cret')

    expect(await store.delete('u', 'DB_PASS')).toBe(true)
    expect(await store.resolve('u', 'DB_PASS')).toBeNull()
  })

  it('is create-only and preserves the planted value on alias conflict', async () => {
    const { store } = await newStore()
    expect(await store.create('u', request('K', 'original'))).not.toBeNull()
    expect(await store.create('u', request('K', 'usurper'))).toBeNull()
    expect(await store.resolve('u', 'K')).toBe('original')
  })

  it('rotates by appending a version and rejects stale writers', async () => {
    const { store, db } = await newStore()
    const first = await store.create('u', request('K', 'v1'))
    expect(first?.version).toBe(1)

    const rotated = await store.rotate('u', 'K', 'v2', 1)
    expect(rotated.status).toBe('updated')
    if (rotated.status === 'updated') expect(rotated.item.version).toBe(2)

    expect(await store.rotate('u', 'K', 'stale', 1)).toEqual({
      status: 'conflict',
      currentVersion: 2,
    })
    expect(await store.resolve('u', 'K')).toBe('v2')
    expect(
      await db.selectFrom('vault_item_versions').select('version').orderBy('version').execute(),
    ).toEqual([{ version: 1 }, { version: 2 }])
  })

  it('keeps provider credentials in the same catalog with a different type and source', async () => {
    const { store } = await newStore()
    await store.set('u', 'provider.key-1', '{"type":"api-key","key":"sentinel"}', {
      label: 'OpenAI API key',
      type: 'api_key',
      source: 'provider',
      tags: ['provider', 'openai'],
    })
    expect(await store.list('u')).toEqual([
      expect.objectContaining({
        key: 'provider.key-1',
        label: 'OpenAI API key',
        type: 'api_key',
        source: 'provider',
        reference: null,
      }),
    ])
    expect(JSON.stringify(await store.list('u'))).not.toContain('sentinel')
  })

  it('scopes items and aliases per user', async () => {
    const { store } = await newStore()
    await store.create('alice', request('K', 'hers'))
    await store.create('bob', request('K', 'his'))
    expect(await store.resolve('alice', 'K')).toBe('hers')
    expect(await store.resolve('bob', 'K')).toBe('his')
  })

  it('guards deletion when a consumer binding exists', async () => {
    const { store } = await newStore()
    await store.create('u', request('K', 'v'))
    await store.bind('u', 'K', {
      consumerType: 'plugin',
      consumerId: 'database',
      field: 'value',
      label: 'Production DB',
    })

    expect(await store.remove('u', 'K')).toEqual({
      status: 'in_use',
      bindings: [
        {
          consumerType: 'plugin',
          consumerId: 'database',
          field: 'value',
          label: 'Production DB',
        },
      ],
    })
    expect(await store.remove('u', 'K', { force: true })).toEqual({ status: 'deleted' })
  })

  it('distinguishes missing from corrupt payloads and never returns corrupt as null', async () => {
    const { store, db } = await newStore()
    expect(await store.resolveDetailed('u', 'NOPE')).toEqual({ status: 'missing' })
    const item = await store.create('u', request('K', 'v'))
    await db
      .updateTable('vault_item_versions')
      .set({ encrypted_payload: 'damaged' })
      .where('item_id', '=', item!.id)
      .execute()

    expect(await store.resolveDetailed('u', 'K')).toEqual({
      status: 'corrupt',
      itemId: item!.id,
    })
    expect(store.resolve('u', 'K')).rejects.toBeInstanceOf(VaultPayloadError)
  })

  it('binds AES-GCM ciphertext to user, item and version through AAD', async () => {
    const db = createDatabase()
    databases.push(db)
    await migrateToLatest(db)
    const store = createSecretsStore({
      db,
      keyDir,
      cipher: createAesCipher(randomBytes(32)),
    })
    const a = await store.create('u', request('A', 'alpha'))
    const b = await store.create('u', request('B', 'bravo'))
    const rows = await db
      .selectFrom('vault_item_versions')
      .select(['item_id', 'encrypted_payload'])
      .execute()
    const aCipher = rows.find((row) => row.item_id === a!.id)!.encrypted_payload
    const bCipher = rows.find((row) => row.item_id === b!.id)!.encrypted_payload
    await db
      .updateTable('vault_item_versions')
      .set({ encrypted_payload: bCipher })
      .where('item_id', '=', a!.id)
      .execute()
    await db
      .updateTable('vault_item_versions')
      .set({ encrypted_payload: aCipher })
      .where('item_id', '=', b!.id)
      .execute()

    expect((await store.resolveDetailed('u', 'A')).status).toBe('corrupt')
    expect((await store.resolveDetailed('u', 'B')).status).toBe('corrupt')
  })

  it('records value-free audit rows for create, rotate and use', async () => {
    const { store, db } = await newStore()
    await store.create('u', request('K', 'audit-sentinel'))
    await store.rotate('u', 'K', 'rotated-sentinel', 1)
    await store.resolve('u', 'K', {
      actorType: 'plugin',
      actorId: 'database',
      consumerType: 'connection',
      consumerId: 'prod',
    })
    const rows = await db.selectFrom('vault_audit').selectAll().execute()
    expect(rows.map((row) => row.operation)).toEqual(['create', 'rotate', 'use'])
    expect(JSON.stringify(rows)).not.toContain('sentinel')
  })

  it('resolves exactly one winner under racing create-only writes', async () => {
    const { store } = await newStore()
    const results = await Promise.all([
      store.setIfAbsent('u', 'K', 'first'),
      store.setIfAbsent('u', 'K', 'second'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const resolved = await store.resolve('u', 'K')
    expect(resolved).not.toBeNull()
    expect(['first', 'second']).toContain(resolved!)
  })
})

describe('Vault service boundary', () => {
  it('exposes create/rotate/list/remove but never resolve', async () => {
    const { store } = await newStore()
    const service = createSecretsService(store)
    const first = await service.create('u', request('K', 'v1'))
    expect(first.version).toBe(1)
    expect((await service.rotate('u', 'K', { value: 'v2', expectedVersion: 1 })).version).toBe(2)
    expect('resolve' in service).toBe(false)
  })

  it('returns a typed conflict for duplicate create', async () => {
    const { store } = await newStore()
    const service = createSecretsService(store)
    await service.create('u', request('K', 'original'))
    expect(service.create('u', request('K', 'other'))).rejects.toMatchObject({
      status: 409,
      code: 'vault_alias_exists',
    })
    expect(await store.resolve('u', 'K')).toBe('original')
  })
})

describe('secret token interpolation', () => {
  const resolve = async (key: string) => ({ DB_PW: 'p@ss', DB_URL: 'postgres://h/db' })[key] ?? null

  it('detects and resolves embedded and whole-value handles', async () => {
    expect(hasSecretTokens('postgres://u:${secret:DB_PW}@h/db')).toBe(true)
    expect(await resolveSecretTokens('postgres://u:${secret:DB_PW}@h/db', resolve)).toBe(
      'postgres://u:p@ss@h/db',
    )
    expect(await resolveSecretTokens('${secret:DB_URL}', resolve)).toBe('postgres://h/db')
  })

  it('passes through token-free strings and rejects missing items', async () => {
    expect(await resolveSecretTokens('sqlite:/tmp/x.db', resolve)).toBe('sqlite:/tmp/x.db')
    expect(resolveSecretTokens('${secret:NOPE}', resolve)).rejects.toThrow('Secret not found: NOPE')
  })

  it('has no shared global-regex lastIndex state', async () => {
    const url = 'postgres://u:${secret:DB_PW}@h/db'
    expect(hasSecretTokens(url)).toBe(true)
    expect(hasSecretTokens(url)).toBe(true)
    expect(await resolveSecretTokens(url, resolve)).toBe('postgres://u:p@ss@h/db')
  })
})

describe('master key safety', () => {
  it('never replaces a malformed existing master key', async () => {
    const sub = path.join(keyDir, 'bad-key')
    const db = createDatabase()
    databases.push(db)
    await migrateToLatest(db)
    await createSecretsStore({ db, keyDir: sub }).create('u', request('K', 'v'))
    const keyFile = path.join(sub, '.masterkey')
    const good = await readFile(keyFile, 'utf8')
    await writeFile(keyFile, good.slice(0, 8), 'utf8')

    const nextDb = createDatabase()
    databases.push(nextDb)
    await migrateToLatest(nextDb)
    expect(
      createSecretsStore({ db: nextDb, keyDir: sub }).create('u', request('K2', 'v2')),
    ).rejects.toThrow(/malformed/)
    expect(await readFile(keyFile, 'utf8')).toBe(good.slice(0, 8))
  })
})
