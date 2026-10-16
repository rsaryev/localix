import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scratchGitEnv } from './scratch-git-env'
import {
  AGGREGATOR,
  CATALOG,
  REFRESH_INTERVAL_MS,
  refreshModelCatalog,
} from './refresh-model-catalog'

const env = {
  ...scratchGitEnv(),
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}
Object.assign(process.env, env)

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0)
    throw new Error(`git ${args.join(' ')}: ${await new Response(proc.stderr).text()}`)
  return out.trim()
}

let root: string
const provider = () => join(root, CATALOG, 'a.models.ts')
const writeCatalog = async (models: string) => {
  await writeFile(provider(), `export const a = ${models}\n`)
  await writeFile(join(root, AGGREGATOR), `export * from './providers/a.models'\n`)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'catalog-'))
  await mkdir(join(root, CATALOG), { recursive: true })
  await writeFile(join(root, 'vendor/pi/packages/ai/package.json'), '{}\n')
  await writeCatalog('["m1"]')
  await git(root, 'init', '-q')
  await git(root, 'add', '-A')
  await git(root, 'commit', '-qm', 'catalog')
})
afterEach(() => rm(root, { recursive: true, force: true }))

const now = 10 * REFRESH_INTERVAL_MS

describe('refreshModelCatalog', () => {
  test('a changed, valid catalog is staged as ONE output — providers and aggregator together', async () => {
    const outcome = await refreshModelCatalog(root, {
      now,
      generate: async () => (await writeCatalog('["m1", "m2"]'), true),
      check: async () => true,
    })
    expect(outcome).toBe('refreshed')
    const staged = await git(root, 'diff', '--cached', '--name-only')
    expect(staged).toContain('a.models.ts')
  })

  test('within the hour it does not touch the network again', async () => {
    let calls = 0
    const generate = async () => (calls++, true)
    await refreshModelCatalog(root, { now, generate, check: async () => true })
    expect(
      await refreshModelCatalog(root, { now: now + 60_000, generate, check: async () => true }),
    ).toBe('fresh')
    expect(calls).toBe(1)
    // …unless forced (a sync, or a person who wants it now).
    await refreshModelCatalog(root, {
      now: now + 60_000,
      force: true,
      generate,
      check: async () => true,
    })
    expect(calls).toBe(2)
  })

  test('a regenerated catalog that fails its own check is reverted, never committed', async () => {
    const outcome = await refreshModelCatalog(root, {
      now,
      generate: async () => (await writeCatalog('["broken"'), true),
      check: async () => false,
    })
    expect(outcome).toBe('reverted')
    expect(await readFile(provider(), 'utf8')).toBe('export const a = ["m1"]\n')
    expect(await git(root, 'status', '--porcelain')).toBe('')
  })

  test('offline keeps the committed catalog and never blocks', async () => {
    const outcome = await refreshModelCatalog(root, {
      now,
      generate: async () => (await writeCatalog('["half-written'), false),
      check: async () => true,
    })
    expect(outcome).toBe('offline')
    expect(await readFile(provider(), 'utf8')).toBe('export const a = ["m1"]\n')
  })
})
