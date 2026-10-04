import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { ProviderEntry } from '@localixai/agent/catalog'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProviderConnectionsService } from './service'

const tempDir = join(process.cwd(), 'tmp', 'env-detect-tests')
let USER = 'user-1'
const SECRET = 'sk-ant-super-secret-value'

const provider = (id: string, name: string, env: string[]): ProviderEntry =>
  ({ id, name, modelCount: 1, authType: 'api-key', env }) as ProviderEntry

// anthropic key present; openai key is blank (whitespace only); mistral absent.
const ENV = { ANTHROPIC_API_KEY: SECRET, OPENAI_API_KEY: '   ' } as Record<
  string,
  string | undefined
>
const CATALOG: ProviderEntry[] = [
  provider('anthropic', 'Anthropic', ['ANTHROPIC_API_KEY']),
  provider('openai', 'OpenAI', ['OPENAI_API_KEY']),
  provider('mistral', 'Mistral', ['MISTRAL_API_KEY']),
]

describe('provider env-key auto-detection', () => {
  let db: ReturnType<typeof createDatabase>
  let service: ReturnType<typeof createProviderConnectionsService>

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    service = createProviderConnectionsService({
      db,
      catalogProviders: async () => CATALOG,
      env: ENV,
    })
  })

  // A user per test. The connection state is per-user, and two of these tests want
  // OPPOSITE states of it — "anthropic is detected" and "anthropic dropped out because
  // it is already connected" — which declaration order used to arrange silently.
  beforeEach(() => {
    USER = `user-${randomUUID()}`
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(tempDir, { recursive: true, force: true })
  })

  test('detects only providers whose env key is present + non-blank; presence-only payload', async () => {
    const { providers } = await service.listEnvDetectedProviders(USER)
    expect(providers).toHaveLength(1)
    expect(providers[0]).toEqual({
      providerId: 'anthropic',
      providerName: 'Anthropic',
      envVar: 'ANTHROPIC_API_KEY',
    })
    // The secret value never appears in the detection payload.
    expect(JSON.stringify(providers)).not.toContain(SECRET)
  })

  test('connectFromEnv reads the key server-side and stores it; secret never on the wire', async () => {
    const conn = await service.connectFromEnv(USER, { providerId: 'anthropic' })
    expect(conn.providerId).toBe('anthropic')
    expect(conn.authType).toBe('api-key')
    expect(conn.label).toBe('Anthropic (env)')
    expect(conn.hasApiKey).toBe(true)
    // The returned DTO carries only masked keys — the raw secret is absent.
    expect(JSON.stringify(conn)).not.toContain(SECRET)
  })

  test('an already-connected provider drops out of the detected list', async () => {
    await service.connectFromEnv(USER, { providerId: 'anthropic' })
    const { providers } = await service.listEnvDetectedProviders(USER)
    expect(providers.find((p) => p.providerId === 'anthropic')).toBeUndefined()
  })

  test('connectFromEnv throws when no key is present in the environment', () => {
    // openai's env value is blank; mistral is absent — both must refuse.
    expect(service.connectFromEnv(USER, { providerId: 'openai' })).rejects.toThrow()
    expect(service.connectFromEnv(USER, { providerId: 'mistral' })).rejects.toThrow()
  })

  test('no catalog wired → detection returns nothing (feature off)', async () => {
    const bare = createProviderConnectionsService({ db, env: ENV })
    expect((await bare.listEnvDetectedProviders(USER)).providers).toHaveLength(0)
  })
})
