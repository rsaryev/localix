import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { __resetBundledSyncCache } from './bundled-install'
import { createPluginService } from './service'

type CounterGlobal = typeof globalThis & {
  __localixInspectionRegisterCount?: number
  __localixInspectionShouldFail?: boolean
}

const counterGlobal = globalThis as CounterGlobal
const previousEnv = {
  bundled: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  claudeConfig: process.env.CLAUDE_CONFIG_DIR,
}

let root: string
let entrypoint: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

const registerSource = (revision: number) => `
export function register(ctx) {
  globalThis.__localixInspectionRegisterCount =
    (globalThis.__localixInspectionRegisterCount ?? 0) + 1
  if (globalThis.__localixInspectionShouldFail) {
    globalThis.__localixInspectionShouldFail = false
    throw new Error('transient inspection failure')
  }
  return {
    tools: [{
      name: "inspection_context",
      label: ctx.userId + " @ " + ctx.cwd,
      description: "Expose the inspection context.",
      inputSchema: {},
      execute: async () => ({ content: "ok" }),
    }],
  }
}
// revision ${revision}
`

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'plugin-service-inspection-'))
  const bundled = join(root, 'bundled')
  const pluginDir = join(bundled, 'inspection-cache-fixture')
  entrypoint = join(pluginDir, 'tools.mjs')
  await mkdir(pluginDir, { recursive: true })
  await mkdir(join(root, 'home'), { recursive: true })
  await mkdir(join(root, 'claude-config'), { recursive: true })
  await writeFile(
    join(pluginDir, 'plugin.json'),
    JSON.stringify({
      name: 'inspection-cache-fixture',
      version: '1.0.0',
      apiVersion: 1,
      description: 'register side-effect regression fixture',
      defaultEnabled: true,
      tools: './tools.mjs',
      config: { label: { type: 'string', default: 'first' } },
    }),
  )
  await writeFile(entrypoint, registerSource(1))

  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = bundled
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-config')
  counterGlobal.__localixInspectionRegisterCount = 0

  db = createDatabase()
  await migrateToLatest(db)
  service = createPluginService({
    db,
    homeDir: join(root, 'home'),
    resolveProjectCwd: async (_userId, projectId) => join(root, `workspace-${projectId}`),
  })
})

afterAll(async () => {
  await destroyDatabase(db)
  await rm(root, { recursive: true, force: true })
  delete counterGlobal.__localixInspectionRegisterCount
  delete counterGlobal.__localixInspectionShouldFail
  for (const [key, value] of Object.entries(previousEnv)) {
    const envKey = key === 'bundled' ? 'LOCALIX_BUNDLED_PLUGINS_DIR' : 'CLAUDE_CONFIG_DIR'
    if (value === undefined) delete process.env[envKey]
    else process.env[envKey] = value
  }
})

describe('plugin settings native inspection cache', () => {
  test('reuses register output until config, enablement, or the entrypoint changes', async () => {
    await service.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: true })
    await service.listPlugins('u1')
    await service.listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(1)

    await service.setConfig('u1', {
      name: 'inspection-cache-fixture',
      values: { label: 'changed' },
    })
    await service.listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(2)

    await writeFile(entrypoint, registerSource(2))
    const future = new Date(Date.now() + 2000)
    await utimes(entrypoint, future, future)
    // A completed bundled-sync pass answers for a short window (SYNC_FRESH_MS) so a
    // startup does not content-hash every bundled tree ~10 times. Editing a source
    // entrypoint mid-test is faster than that window; step past it, since what this
    // test pins is the INSPECTION cache, not the sync window. The window's own two
    // halves — it holds, and the next pass after it re-syncs — are pinned in
    // bundled-install.test.ts.
    __resetBundledSyncCache()
    await service.listPlugins('u1')
    await service.listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(3)

    await service.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: false })
    await service.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: true })
    await service.listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(4)

    // Failed inspection is shared only for that attempt, never frozen into the
    // cache: the next list retries register(), then caches the successful retry.
    counterGlobal.__localixInspectionShouldFail = true
    const failed = await service.setConfig('u1', {
      name: 'inspection-cache-fixture',
      values: { label: 'retry-after-error' },
    })
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(5)
    expect(failed.error).toContain('transient inspection failure')
    await service.listPlugins('u1')
    await service.listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(6)

    const scoped = await service.listPlugins('u1', { projectId: 'project-1' })
    await service.listPlugins('u1', { projectId: 'project-1' })
    expect(
      scoped.plugins
        .find((plugin) => plugin.name === 'inspection-cache-fixture')
        ?.provides.tools.find((tool) => tool.name === 'inspection_context')?.label,
    ).toBe(`u1 @ ${join(root, 'workspace-project-1')}`)
    // A genuinely different runtime context is inspected once, then reused.
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(7)

    await service.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: false })
    await service.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: true })
    await service.listPlugins('u1', { projectId: 'project-1' })
    // Re-enabling the global plugin rematerializes its own response and
    // invalidates every project-context variant.
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(9)
  })

  test('a restarted service serves the stored inspection without running register()', async () => {
    const restart = () =>
      createPluginService({
        db,
        homeDir: join(root, 'home'),
        resolveProjectCwd: async (_userId, projectId) => join(root, `workspace-${projectId}`),
      })
    const tools = (list: Awaited<ReturnType<typeof service.listPlugins>>) =>
      list.plugins.find((plugin) => plugin.name === 'inspection-cache-fixture')?.provides.tools

    const live = await service.listPlugins('u1')
    await waitForStoredInspection()
    const before = counterGlobal.__localixInspectionRegisterCount
    // A new process: empty memory, the same home. Its first listing imports no plugin code.
    const restarted = await restart().listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(before)
    expect(tools(restarted)).toEqual(tools(live))

    // A disable/enable round trip drops the stored answer too, so the next process re-asks.
    const toggled = restart()
    await toggled.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: false })
    await toggled.setEnabled('u1', { name: 'inspection-cache-fixture', enabled: true })
    await waitForStoredInspection()
    const afterToggle = counterGlobal.__localixInspectionRegisterCount ?? 0
    await restart().listPlugins('u1')
    expect(counterGlobal.__localixInspectionRegisterCount).toBe(afterToggle)
    expect(afterToggle).toBeGreaterThan(before ?? 0)
  })
})

/** The store coalesces writes; wait until the listing's answer is on disk. */
async function waitForStoredInspection(): Promise<void> {
  const file = join(root, 'home', '.localix', 'cache', 'plugin-inspection-cache-v1.json')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const text = await readFile(file, 'utf8').catch(() => '')
    if (text.includes('inspection_context')) {
      await Bun.sleep(80)
      return
    }
    await Bun.sleep(20)
  }
  throw new Error('inspection was never persisted')
}
