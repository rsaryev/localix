import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DiscoveredMiniApp } from './discovery'
import {
  createMiniAppInspectionStore,
  durableInspectionFingerprint,
  type MiniAppToolInspection,
} from './inspection-store'
import { MARKER_FILE, MARKER_KIND } from './managed-copy'

let home: string
const cacheFile = () => join(home, '.localix', 'cache', 'mini-app-inspection-cache-v1.json')

const inspection = (toolName: string): MiniAppToolInspection => ({
  tools: [{ name: toolName, label: toolName, description: 'a tool' }],
  backendSubsystems: ['backend'],
  routeMounts: [],
  resourceProviders: [],
  searchProviders: [],
  contextProviders: [],
  wsCommands: [],
  channels: [],
})

const entry = (app: string, fingerprint: string, toolName = `${app}_tool`) => ({
  app,
  projectId: '',
  fingerprint,
  result: inspection(toolName),
})

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'mini-app-inspection-store-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('mini app inspection store', () => {
  test('an entry written by one process is served to the next only under its fingerprint', async () => {
    const first = createMiniAppInspectionStore(home)
    first.set('k1', entry('alpha', 'fp-1'))
    await first.flush()

    const restarted = createMiniAppInspectionStore(home)
    expect(await restarted.get('k1', 'fp-1')).toEqual(inspection('alpha_tool'))
    // A changed input is a miss, never the stale answer.
    expect(await restarted.get('k1', 'fp-2')).toBeNull()
    expect(await restarted.get('other-key', 'fp-1')).toBeNull()
  })

  test('the file names no mini app path, user or cwd in its keys', async () => {
    const store = createMiniAppInspectionStore(home)
    store.set('/secret/mini-app/dir\u0000u1\u0000/Users/me/project', entry('alpha', 'fp'))
    await store.flush()
    const text = await readFile(cacheFile(), 'utf8')
    expect(text).not.toContain('/secret/mini-app/dir')
    expect(text).not.toContain('/Users/me/project')
  })

  test('a lifecycle drop persists, so a restart cannot resurrect the dropped answer', async () => {
    const store = createMiniAppInspectionStore(home)
    store.set('k1', entry('alpha', 'fp'))
    store.set('k2', entry('beta', 'fp'))
    store.drop((stored) => stored.app === 'alpha')
    await store.flush()

    const restarted = createMiniAppInspectionStore(home)
    expect(await restarted.get('k1', 'fp')).toBeNull()
    expect(await restarted.get('k2', 'fp')).toEqual(inspection('beta_tool'))

    restarted.drop()
    await restarted.flush()
    expect(await createMiniAppInspectionStore(home).get('k2', 'fp')).toBeNull()
  })

  test('a corrupt or foreign file is an empty cache, and the next write replaces it', async () => {
    await mkdir(join(home, '.localix', 'cache'), { recursive: true })
    await writeFile(cacheFile(), '{"version":1,"entries":{"x": ')
    const store = createMiniAppInspectionStore(home)
    expect(await store.get('k1', 'fp')).toBeNull()
    store.set('k1', entry('alpha', 'fp'))
    await store.flush()
    expect(await createMiniAppInspectionStore(home).get('k1', 'fp')).not.toBeNull()

    // Structurally wrong entries are skipped one by one; a valid neighbour survives.
    const parsed = JSON.parse(await readFile(cacheFile(), 'utf8'))
    parsed.entries.bogus = { app: 'x', projectId: '', fingerprint: 'fp', result: {} }
    await writeFile(cacheFile(), JSON.stringify(parsed))
    const reread = createMiniAppInspectionStore(home)
    expect(await reread.get('k1', 'fp')).not.toBeNull()

    await writeFile(cacheFile(), JSON.stringify({ version: 999, entries: parsed.entries }))
    expect(await createMiniAppInspectionStore(home).get('k1', 'fp')).toBeNull()
  })
})

describe('durable inspection fingerprint', () => {
  const appAt = (dir: string) => ({ dir }) as DiscoveredMiniApp

  test('a managed copy is keyed by the content fingerprint it was installed with', async () => {
    const dir = join(home, 'managed')
    await mkdir(dir, { recursive: true })
    const mark = (fingerprint: string) =>
      writeFile(join(dir, MARKER_FILE), JSON.stringify({ kind: MARKER_KIND, fingerprint }))
    await mark('tree-a')
    const a = await durableInspectionFingerprint(appAt(dir), 'memory')
    expect(await durableInspectionFingerprint(appAt(dir), 'memory')).toBe(a)
    await mark('tree-b')
    expect(await durableInspectionFingerprint(appAt(dir), 'memory')).not.toBe(a)
    // The in-memory inputs (manifest, config, cwd…) stay part of the key.
    expect(await durableInspectionFingerprint(appAt(dir), 'other-memory')).not.toBe(a)
  })

  test('a user install is keyed by its tree, so an edited sibling module is a miss', async () => {
    const dir = join(home, 'user-app')
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'tools.mjs'), 'export * from "./lib/impl.mjs"')
    await writeFile(join(dir, 'lib', 'impl.mjs'), 'export const tools = []')
    const before = await durableInspectionFingerprint(appAt(dir), 'memory')
    expect(before).not.toBeNull()
    expect(await durableInspectionFingerprint(appAt(dir), 'memory')).toBe(before)

    await writeFile(join(dir, 'lib', 'impl.mjs'), 'export const tools = [1]')
    const future = new Date(Date.now() + 5_000)
    await utimes(join(dir, 'lib', 'impl.mjs'), future, future)
    expect(await durableInspectionFingerprint(appAt(dir), 'memory')).not.toBe(before)
  })
})
