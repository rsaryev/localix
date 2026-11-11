import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { kitEntry } from './testing'
import {
  installedRecord,
  planInstallClosure,
  readFetchedManifest,
  type ClosureInput,
  type FetchedCopy,
} from './install-closure'

const market = (name: string, plugins: Record<string, unknown>[], allow: string[] = []) => ({
  name,
  plugins: plugins.map((fields) => kitEntry({ source: `./${String(fields.name)}`, ...fields })),
  allowCrossMarketplaceDependenciesOn: allow,
})

const input = (over: Partial<ClosureInput> & Pick<ClosureInput, 'marketplaces'>): ClosureInput => ({
  root: 'app@m',
  scope: 'user',
  operation: 'install',
  rootCopy: { manifest: undefined },
  installed: [],
  enabled: {},
  fetch: () => Promise.resolve({ manifest: undefined }),
  ...over,
})

describe('planInstallClosure', () => {
  test("fetches what the plan needs and plans again, so a dependency's plugin.json counts", async () => {
    const fetched: string[] = []
    const copies: Record<string, FetchedCopy> = {
      'a@m': { manifest: { name: 'a', dependencies: ['b'] } },
      'b@m': { manifest: { name: 'b', version: '1.0.0' } },
    }
    const plan = await planInstallClosure(
      input({
        marketplaces: [market('m', [{ name: 'app' }, { name: 'a' }, { name: 'b' }])],
        rootCopy: { manifest: { name: 'app', dependencies: ['a'] } },
        fetch: (id) => {
          fetched.push(id)
          return Promise.resolve(copies[id] ?? { manifest: undefined })
        },
      }),
    )
    expect(plan.ok).toBe(true)
    expect(plan.steps.map((step) => [step.id, step.action])).toEqual([
      ['b@m', 'install'],
      ['a@m', 'install'],
    ])
    expect(fetched).toEqual(['a@m', 'b@m'])
  })

  test("the entry's and the manifest's dependencies both count", async () => {
    const plan = await planInstallClosure(
      input({
        marketplaces: [
          market('m', [{ name: 'app', dependencies: ['a'] }, { name: 'a' }, { name: 'b' }]),
        ],
        rootCopy: { manifest: { name: 'app', dependencies: ['b'] } },
      }),
    )
    expect(plan.steps.map((step) => step.id).sort()).toEqual(['a@m', 'b@m'])
  })

  test('a bare name resolves in the declaring marketplace only', async () => {
    const plan = await planInstallClosure(
      input({
        marketplaces: [market('m', [{ name: 'app' }]), market('other', [{ name: 'a' }])],
        rootCopy: { manifest: { name: 'app', dependencies: ['a'] } },
      }),
    )
    expect(plan.ok).toBe(false)
    expect(plan.issues.map((issue) => issue.message)).toEqual([
      'Dependency "a@m" is not installed and its marketplace does not list it',
    ])
  })

  test('ranges that cannot both hold refuse the plan', async () => {
    const plan = await planInstallClosure(
      input({
        marketplaces: [market('m', [{ name: 'app' }, { name: 'vault' }, { name: 'other' }])],
        rootCopy: { manifest: { name: 'app', dependencies: [{ name: 'vault', version: '^3' }] } },
        installed: [
          installedRecord({
            id: 'other@m',
            scope: 'user',
            manifest: { dependencies: [{ name: 'vault', version: '^2' }] },
          }),
          installedRecord({ id: 'vault@m', scope: 'user', manifest: { version: '2.1.0' } }),
        ],
        enabled: { user: { 'other@m': true, 'vault@m': true } },
      }),
    )
    expect(plan.steps).toEqual([])
    expect(plan.issues[0]?.message).toContain('conflicting version requirements')
  })

  test('an installed and enabled dependency inside its range needs no step', async () => {
    const plan = await planInstallClosure(
      input({
        marketplaces: [market('m', [{ name: 'app' }, { name: 'a' }])],
        rootCopy: { manifest: { name: 'app', dependencies: ['a'] } },
        installed: [installedRecord({ id: 'a@m', scope: 'user', manifest: {} })],
        enabled: { user: { 'a@m': true } },
      }),
    )
    expect(plan).toMatchObject({ ok: true, steps: [] })
  })
})

describe('installedRecord', () => {
  test("a bare dependency name is in the plugin's own marketplace", () => {
    expect(
      installedRecord({
        id: 'x@m',
        scope: 'project',
        manifest: { version: '1', dependencies: ['a', 'b@n'] },
      }),
    ).toEqual({
      id: 'x@m',
      scope: 'project',
      version: '1',
      dependencies: [
        { name: 'a', marketplace: 'm' },
        { name: 'b', marketplace: 'n' },
      ],
    })
  })
})

describe('readFetchedManifest', () => {
  const dir = tempDirPerTest('fetched-manifest')
  test('reads plugin.json as written; none is undefined', async () => {
    expect(await readFetchedManifest(dir())).toBeUndefined()
    await fs.mkdir(join(dir(), '.claude-plugin'), { recursive: true })
    await fs.writeFile(join(dir(), '.claude-plugin/plugin.json'), '{"name":"x","version":"2.0.0"}')
    expect(await readFetchedManifest(dir())).toMatchObject({ name: 'x', version: '2.0.0' })
  })
})
