import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { ZodObject } from 'zod'

import { MINI_APP_BACKEND_HOST_MODULES } from './authoring/kit-layout'
import { hostModule, installBackendHostModules } from './backend-host-modules'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * A backend built the way staging builds one — shared modules EXTERNAL — into a directory with no
 * node_modules anywhere above it, so its bare imports can only be answered by the host.
 */
async function buildExternalBackend(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'localix-host-modules-'))
  dirs.push(dir)
  const entry = join(dir, 'index.ts')
  writeFileSync(
    entry,
    [
      "import { Hono } from 'hono'",
      "import { z, ZodObject } from 'zod'",
      "import * as sdk from '@localixai/mini-app-sdk/backend'",
      'const body = z.object({ name: z.string() })',
      "const app = new Hono().post('/greet', async (c) => c.json({ hi: body.parse(await c.req.json()).name }))",
      'export const shared = { Hono, ZodObject, sdk, app, schema: body }',
    ].join('\n'),
  )
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    outdir: join(dir, 'out'),
    external: [...MINI_APP_BACKEND_HOST_MODULES],
  })
  expect(result.success).toBe(true)
  return join(dir, 'out', 'index.js')
}

// Every backend bundled its own zod, hono and SDK: 18 copies of zod, ~104 MB for 20 backends.
describe('host-provided backend modules', () => {
  test('an external backend runs on the host instance of every shared module', async () => {
    installBackendHostModules()
    const bundle = await buildExternalBackend()
    const { shared } = (await import(bundle)) as {
      shared: { Hono: unknown; ZodObject: unknown; sdk: unknown; app: Hono; schema: unknown }
    }
    // One class identity: a mini app's schema is a host `ZodObject`, its app a host `Hono`.
    expect(shared.ZodObject).toBe(ZodObject)
    expect(shared.Hono).toBe(Hono)
    expect(shared.schema).toBeInstanceOf(ZodObject)
    // The namespace object is Bun's own wrapper; what must be shared are its members.
    expect((shared.sdk as { ApiError: unknown }).ApiError).toBe(
      hostModule('@localixai/mini-app-sdk/backend').ApiError,
    )
    const response = await shared.app.request('/greet', {
      method: 'POST',
      body: JSON.stringify({ name: 'ada' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(await response.json()).toEqual({ hi: 'ada' })
  })

  test('every listed specifier has an instance to serve', () => {
    for (const specifier of MINI_APP_BACKEND_HOST_MODULES) {
      expect(Object.keys(hostModule(specifier)).length).toBeGreaterThan(0)
    }
  })

  test('installing twice registers once', () => {
    expect(() => {
      installBackendHostModules()
      installBackendHostModules()
    }).not.toThrow()
  })
})
