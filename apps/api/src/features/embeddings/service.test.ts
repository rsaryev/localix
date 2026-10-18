import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMessagesSemanticSource } from '../chat/semantic-sources'
import { createBackgroundDownloads } from '../local-models/background'
import type { InstallJob } from '../local-models/contracts'
import type { SemanticServiceDeps } from './service'
import { createSemanticService } from './service'
import { createSemanticStore } from './store'
import { FAKE_MODEL, fakeVector } from './testing/fake-engine'

/**
 * Local models as the semantic service sees them: the real background reconciler over a fake
 * download that succeeds or fails after a moment, announcing an install to subscribers.
 */
function fakeLocalModels(options: { installed: boolean; installSucceeds?: boolean }) {
  let installed = options.installed
  let job: InstallJob | null = null
  const listeners = new Set<() => void>()
  const announce = () => listeners.forEach((l) => l())
  const downloads: string[] = []
  const paused: string[] = []
  const background = createBackgroundDownloads({
    isInstalled: () => installed,
    jobs: () => (job ? [job] : []),
    start: async (spec) => {
      downloads.push(spec.id)
      job = {
        modelId: spec.id,
        label: spec.label,
        background: true,
        phase: 'downloading',
        received: 1,
        total: 3,
        rate: null,
        error: null,
      }
      await Bun.sleep(5)
      // Paused meanwhile: the download ends without installing.
      if (job?.phase !== 'downloading') return
      if (options.installSucceeds) {
        installed = true
        job = null
      } else {
        job = { ...job, phase: 'failed', error: 'Could not reach huggingface.co' }
      }
      announce()
    },
    // A pause takes the job out of the queue, keeping its files.
    pause: async (modelId) => {
      paused.push(modelId)
      job = null
    },
  })
  const local: SemanticServiceDeps['localModels'] = {
    isInstalled: () => installed,
    background,
    catalog: { resolve: async () => null, list: async () => [] },
    job: () => job,
    remove: async () => {
      installed = false
    },
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
  return Object.assign(local, { downloads, paused })
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
  test('on by default: indexes with the installed model and search fuses meaning', async () => {
    const { service } = await setup(fakeLocalModels({ installed: true }))
    await service.boot()
    await settle(service)
    expect(service.enabled()).toBe(true)
    expect(service.strategy().mode).toBe('hybrid')
    const [match] = await service.reader.query('u1', 'chat.messages', 'card payment')
    expect(match?.key).toBe('m1')
    await service.shutdown()
  })

  test('without the model it is fetched in the background; words answer until it is here', async () => {
    const local = fakeLocalModels({ installed: false, installSucceeds: true })
    const { service } = await setup(local)
    await service.boot()
    expect(local.downloads).toEqual([FAKE_MODEL.id])
    expect(service.strategy()).toEqual({ mode: 'lexical', reason: 'not-installed' })
    await Bun.sleep(30)
    await settle(service)
    expect(service.strategy().mode).toBe('hybrid')
    expect((await service.status()).index.items).toBe(1)
    await service.shutdown()
  })

  test('a failed download is reported, search stays lexical, and retry fetches again', async () => {
    const local = fakeLocalModels({ installed: false, installSucceeds: false })
    const { service } = await setup(local)
    await service.boot()
    await Bun.sleep(30)
    expect((await service.status()).install).toMatchObject({
      state: 'failed',
      error: 'Could not reach huggingface.co',
    })
    expect(service.strategy()).toEqual({ mode: 'lexical', reason: 'not-installed' })
    await service.retry()
    expect(local.downloads).toHaveLength(2)
  })

  test('turned off, the model is no longer wanted: its background download pauses', async () => {
    const local = fakeLocalModels({ installed: false, installSucceeds: true })
    const { service } = await setup(local)
    await service.boot()
    await service.disable()
    expect(local.paused).toEqual([FAKE_MODEL.id])
    expect(service.strategy()).toEqual({ mode: 'lexical', reason: 'off' })
  })

  test('enable with the model installed indexes and switches search to hybrid', async () => {
    const { service } = await setup(fakeLocalModels({ installed: true }))
    await service.disable()
    await service.enable()
    await settle(service)
    expect(service.strategy().mode).toBe('hybrid')
    expect(await service.status()).toMatchObject({ enabled: true, index: { items: 1, chunks: 1 } })
    await service.shutdown()
  })

  test('disable returns search to lexical and keeps the vectors for next time', async () => {
    const { service } = await setup(fakeLocalModels({ installed: true }))
    await service.enable()
    await settle(service)
    await service.disable()
    expect(service.strategy()).toEqual({ mode: 'lexical', reason: 'off' })
    expect((await service.status()).index.items).toBe(1)
  })

  test('pause holds indexing and its changes until resume', async () => {
    const { db, service } = await setup(fakeLocalModels({ installed: true }))
    await service.enable()
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
