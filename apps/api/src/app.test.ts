import { describe, test, expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createHealthRoutes } from './health'
import { LOCALIX_API_PRODUCT_ID, LOCALIX_API_PROTOCOL_VERSION } from './lib/runtime-protocol'

/**
 * The liveness probe is dependency-free, so it is exercised directly.
 *
 * This used to call `createApp({ … })` with five of its thirty-odd required services and
 * lean on the other twenty-seven never being dereferenced along the `/health` path. That
 * "the app boots" reassurance was hollow — it only proved createApp survives a dep bag no
 * caller could ever construct — and nothing checked it: `bun test` does not typecheck, and
 * tsconfig.json excludes *.test.ts, so the invalid AppDeps compiled nowhere and failed
 * nowhere. Health now lives behind its own router (health.ts) that createApp mounts, so
 * the real thing is tested with no fixture, no fake, and no cast.
 */
describe('health probe', () => {
  test('GET /health returns ok', async () => {
    const response = await createHealthRoutes({
      instanceId: 'instance-a',
      startedAt: 'now',
      databaseId: 'database-a',
    }).request('/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      productId: LOCALIX_API_PRODUCT_ID,
      instanceId: 'instance-a',
      protocolVersion: LOCALIX_API_PROTOCOL_VERSION,
      startedAt: 'now',
      databaseId: 'database-a',
      miniAppContract: expect.any(String),
    })
  })

  // The mini app authoring plugin builds against the kit of the release it runs in: it reads the
  // running Localix's version here and downloads that release's kit.
  test('says which Localix release is running, when the build knows it', async () => {
    const info = { instanceId: 'instance-a', startedAt: 'now' }
    const released = await createHealthRoutes({ ...info, version: '0.4.0' }).request('/health')
    expect(((await released.json()) as { version?: string }).version).toBe('0.4.0')
    const source = await createHealthRoutes(info).request('/health')
    expect(await source.json()).not.toHaveProperty('version')
  })

  // The authoring plugin compares this with the `contract` of the kit it builds against: a kit
  // staged from other sources than the running Localix's names another one.
  test('names the mini app contract it implements: the committed one', async () => {
    const committed = readFileSync(
      join(import.meta.dir, '../../../packages/mini-app-sdk/mini-app.api.md'),
      'utf8',
    )
    const response = await createHealthRoutes().request('/health')
    expect(((await response.json()) as { miniAppContract?: string }).miniAppContract).toBe(
      createHash('sha256').update(committed).digest('hex'),
    )
  })

  // A reopen right after quit attached to the dying runtime because this answered 200 for
  // the whole teardown. Every liveness probe keys on `response.ok`.
  test('answers 503 draining once shutdown has begun, so nothing attaches to it', async () => {
    let draining = false
    const routes = createHealthRoutes({
      instanceId: 'instance-a',
      startedAt: 'now',
      isDraining: () => draining,
    })
    expect((await routes.request('/health')).status).toBe(200)
    draining = true
    const response = await routes.request('/health')
    expect(response.status).toBe(503)
    expect(response.ok).toBe(false)
    expect(((await response.json()) as { status: string }).status).toBe('draining')
  })
})
