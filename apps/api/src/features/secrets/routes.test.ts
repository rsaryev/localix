import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { Kysely } from 'kysely'

import type { AppContext } from '../../app'
import type { AppDatabase } from '../../db'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { plaintextCipher } from './cipher'
import { createSecretsRoutes } from './routes'
import { createSecretsService } from './service'
import { createSecretsStore } from './store'

describe('Vault HTTP boundary', () => {
  let db: Kysely<AppDatabase>
  let store: ReturnType<typeof createSecretsStore>
  let app: Hono<AppContext>

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    store = createSecretsStore({ db, cipher: plaintextCipher })
    app = new Hono<AppContext>()
    app.use('*', async (context, next) => {
      context.set('userId', 'u')
      await next()
    })
    app.route('/rpc/secrets', createSecretsRoutes(createSecretsService(store)))
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('create/list/rotate responses and errors never echo the value', async () => {
    const sentinel = 'never-echo-this-secret'
    const created = await app.request('/rpc/secrets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'API_KEY',
        value: sentinel,
        type: 'api_key',
        tags: ['test'],
      }),
    })
    expect(created.status).toBe(201)
    expect(created.headers.get('cache-control')).toBe('no-store')
    expect(await created.text()).not.toContain(sentinel)

    const duplicate = await app.request('/rpc/secrets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'API_KEY',
        value: `${sentinel}-duplicate`,
        type: 'api_key',
        tags: [],
      }),
    })
    expect(duplicate.status).toBe(409)
    expect(await duplicate.text()).not.toContain(sentinel)
    expect(await store.resolve('u', 'API_KEY')).toBe(sentinel)

    const list = await app.request('/rpc/secrets')
    const listText = await list.text()
    expect(listText).toContain('secret:API_KEY')
    expect(listText).not.toContain(sentinel)

    const rotated = await app.request('/rpc/secrets/API_KEY', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: `${sentinel}-rotated`, expectedVersion: 1 }),
    })
    expect(rotated.status).toBe(200)
    expect(await rotated.text()).not.toContain(sentinel)

    const versions = await app.request('/rpc/secrets/API_KEY/versions')
    const versionsText = await versions.text()
    expect(versionsText).toContain('"version":2')
    expect(versionsText).toContain('"reason":"rotated"')
    expect(versionsText).not.toContain(sentinel)

    await store.resolve('u', 'API_KEY', {
      actorType: 'agent',
      actorId: 'chat-runtime',
      consumerType: 'tool',
      consumerId: 'provider-request',
    })
    const activity = await app.request('/rpc/secrets/activity?limit=20')
    const activityText = await activity.text()
    expect(activityText).toContain('"operation":"use"')
    expect(activityText).toContain('"actorType":"agent"')
    expect(activityText).not.toContain(sentinel)
  })

  test('delete refuses an in-use item and returns value-free consumer metadata', async () => {
    await store.create('u', {
      key: 'DB_PASS',
      value: 'binding-sentinel',
      type: 'database',
      tags: [],
    })
    await store.bind('u', 'DB_PASS', {
      consumerType: 'plugin',
      consumerId: 'database',
      field: 'value',
      label: 'Production DB',
    })
    const response = await app.request('/rpc/secrets/DB_PASS?expectedVersion=1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(409)
    const text = await response.text()
    expect(text).toContain('vault_item_in_use')
    expect(text).toContain('Production DB')
    expect(text).not.toContain('binding-sentinel')
  })

  test('edits title, description, type and tags without changing or returning the value', async () => {
    const sentinel = 'metadata-edit-secret-value'
    await store.create('u', {
      key: 'EDIT_ME',
      value: sentinel,
      label: 'Old title',
      description: 'Old description',
      type: 'secret',
      tags: [],
    })

    const response = await app.request('/rpc/secrets/EDIT_ME', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedVersion: 1,
        title: 'Deployment credential',
        description: 'Linked to the deployment agent',
        type: 'api_key',
        tags: ['deployment', 'agent'],
      }),
    })
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('Deployment credential')
    expect(text).toContain('Linked to the deployment agent')
    expect(text).toContain('"version":2')
    expect(text).not.toContain(sentinel)
    expect(await store.resolve('u', 'EDIT_ME')).toBe(sentinel)

    const versions = await app.request('/rpc/secrets/EDIT_ME/versions')
    expect(await versions.text()).toContain('"reason":"metadata_updated"')

    const stale = await app.request('/rpc/secrets/EDIT_ME', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedVersion: 1, title: 'Stale title' }),
    })
    expect(stale.status).toBe(409)
  })
})
