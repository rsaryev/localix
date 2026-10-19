import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMessagesSemanticSource } from '../chat/semantic-sources'
import type { InstallJob } from '../local-models/contracts'
import type { SemanticServiceDeps } from './service'
import { createSemanticService } from './service'
import { createSemanticStore } from './store'
import { FAKE_MODEL, fakeVector } from './testing/fake-engine'

/**
 * Local models as the semantic service sees them: an installed flag a test flips (the model
 * arriving), a job it can fail, and the retries search asks for. Downloads are theirs, not search's.
 */
function fakeLocalModels(options: { installed: boolean; job?: InstallJob }) {
  let installed = options.installed
  const job: InstallJob | null = options.job ?? null
  const listeners = new Set<() => void>()
  const retries: unknown[] = []
  const local: SemanticServiceDeps['localModels'] = {
    isInstalled: () => installed,
    background: { reconcile: (opts?: unknown) => void retries.push(opts) } as never,
    job: () => job,
    router: {
      ensure: async () => {
        throw new Error('unused')
      },
    } as never,
    status: async () => ({
      runtime: { supported: true, tag: 'b1', installed: true },
      machine: null,
      installed: [],
      jobs: job ? [job] : [],
      paused: [],
      running: [],
      diskBytes: 0,
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  /** The model arrived: what local models announce once a download installs it. */
  const arrive = () => {
    installed = true
    listeners.forEach((l) => l())
  }
  return Object.assign(local, { arrive, retries })
}

async function setup(local: SemanticServiceDeps['localModels']) {
  const db = createDatabase()
  await migrateToLatest(db)
  let embedded = 0
  const service = createSemanticService({
    store: createSemanticStore(db),
    localModels: local,
    model: FAKE_MODEL,
    backend: () => ({
      running: true,
      embed: async (inputs) => {
        embedded += inputs.length
        return inputs.map((i) => [...fakeVector(i)])
      },
      stop: async () => {},
    }),
  })
  service.registerSource(createMessagesSemanticSource(db))
  await db
    .insertInto('agent_sessions')
    .values({ id: 's1', user_id: 'u1', title: 't', project_id: 'p1' })
    .execute()
  await db
    .insertInto('agent_messages')
    .values({
      id: 'm1',
      session_id: 's1',
      user_id: 'u1',
      sequence: 1,
      role: 'user',
      payload_json: '{"content":"payment declined"}',
    })
    .execute()
  return { db, service, embedded: () => embedded }
}

const settle = async (service: Awaited<ReturnType<typeof setup>>['service']) => {
  for (let i = 0; i < 3; i++) {
    await Bun.sleep(10)
    await service.settle()
  }
}

describe('semantic service', () => {
  test('always on: indexes with the installed model and search fuses meaning', async () => {
    const { service } = await setup(fakeLocalModels({ installed: true }))
    await service.boot()
    await settle(service)
    expect(service.strategy().mode).toBe('hybrid')
    const [match] = await service.reader.query('u1', 'chat.messages', 'card payment')
    expect(match?.key).toBe('m1')
    await service.shutdown()
  })

  test('until the model is here words answer; the moment it arrives, indexing starts', async () => {
    const local = fakeLocalModels({ installed: false })
    const { service } = await setup(local)
    await service.boot()
    expect(service.strategy()).toEqual({ mode: 'lexical', reason: 'not-installed' })
    local.arrive()
    await settle(service)
    expect(service.strategy().mode).toBe('hybrid')
    expect((await service.status()).index.items).toBe(1)
    await service.shutdown()
  })

  test('a failed download is reported, search stays lexical, and retry asks local models again', async () => {
    const local = fakeLocalModels({
      installed: false,
      job: {
        modelId: FAKE_MODEL.id,
        label: FAKE_MODEL.label,
        background: true,
        phase: 'failed',
        received: 1,
        total: 3,
        rate: null,
        error: 'Could not reach huggingface.co',
      },
    })
    const { service } = await setup(local)
    await service.boot()
    expect((await service.status()).install).toMatchObject({
      state: 'failed',
      error: 'Could not reach huggingface.co',
    })
    expect(service.strategy()).toEqual({ mode: 'lexical', reason: 'not-installed' })
    await service.retry()
    expect(local.retries).toEqual([{ retry: true }])
  })

  test('an index left behind by the old off switch is compared in full once, then marked on', async () => {
    const { db, service } = await setup(fakeLocalModels({ installed: true }))
    const store = createSemanticStore(db)
    await store.writeSettings({ ...(await store.readSettings()), enabled: false })
    await service.boot()
    await settle(service)
    expect((await store.readSettings()).enabled).toBe(true)
    expect((await service.status()).index.items).toBe(1)
    await service.shutdown()
  })

  test('pause holds indexing and its changes until resume', async () => {
    const { db, service } = await setup(fakeLocalModels({ installed: true }))
    await service.boot()
    await settle(service)
    await service.pause()
    await db
      .insertInto('agent_messages')
      .values({
        id: 'm2',
        session_id: 's1',
        user_id: 'u1',
        sequence: 2,
        role: 'user',
        payload_json: '{"content":"refund the order"}',
      })
      .execute()
    await service.changed('chat.messages', ['m2'])
    await settle(service)
    expect((await service.status()).index).toMatchObject({ phase: 'paused', items: 1 })

    service.resume()
    await settle(service)
    expect((await service.status()).index).toMatchObject({ phase: 'idle', items: 2 })
    await service.shutdown()
  })

  test('a source collection name is registered once', async () => {
    const { db, service } = await setup(fakeLocalModels({ installed: true }))
    expect(() => service.registerSource(createMessagesSemanticSource(db))).toThrow(
      'already registered',
    )
  })
})
