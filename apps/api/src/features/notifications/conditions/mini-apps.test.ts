import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AvailabilityReader } from '../../capabilities/availability'
import type { CapabilitySourceRepository } from '../../capabilities/source-repository'
import { loadEnabledMiniApps } from '../../mini-apps/loader'
import { makeContext } from '../../mini-apps/native'
import { miniAppProblemReporter } from '../../mini-apps/problem-reporter'
import {
  createMiniAppConditions,
  observeMiniAppConditions,
  recordMiniAppCatalogLoad,
} from './mini-apps'
import {
  createTestJournal,
  openRows,
  TEST_USER as U,
  type TestJournal,
} from './testing/test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  observeMiniAppConditions(undefined)
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

async function setup() {
  const test = await createTestJournal()
  journals.push(test)
  return { test, apps: createMiniAppConditions(test.journal, U) }
}

describe('mini app conditions', () => {
  it('a failed load is one row on the app’s own settings row, settled by a clean load', async () => {
    const { test, apps } = await setup()
    apps.loaded(U, { name: 'tracker', displayName: 'Tracker', projectId: '', error: 'boom' })
    const [row] = await openRows(test)
    expect(row?.title).toBe('Could not load the Tracker mini app')
    expect(JSON.stringify(row?.actions)).toContain(
      'localix://ui/settings/mini-apps/mini-app-tracker',
    )
    expect(JSON.stringify(row)).not.toMatch(/plugin/iu)
    apps.loaded(U, { name: 'tracker', projectId: '' })
    expect(await openRows(test)).toEqual([])
  })

  it('a whole-load failure is one row per workspace, settled by the next load that completes', async () => {
    const { test, apps } = await setup()
    observeMiniAppConditions(apps)
    recordMiniAppCatalogLoad(U, 'P1', new Error('ENOENT: mini-app.json'))
    recordMiniAppCatalogLoad(U, 'P2')
    expect((await openRows(test)).map((row) => row.title)).toEqual(['Could not load mini apps'])
    recordMiniAppCatalogLoad(U, 'P1')
    expect(await openRows(test)).toEqual([])
  })

  it('retires every row about an app no scope enables any more, and nothing else', async () => {
    const { test, apps } = await setup()
    apps.loaded(U, { name: 'gone', projectId: '', error: 'boom' })
    apps.channelCrashed('gone', 'echo', 'token revoked')
    apps.loaded(U, { name: 'kept', projectId: '', error: 'boom' })
    apps.reconciled('catalog unreadable')
    await apps.enabled(new Set(['kept']))
    const open = (await openRows(test)).map((row) => row.key.split(':').slice(1, 3).join(':'))
    expect(open.sort()).toEqual(['mini-app:kept', 'mini-apps:reconcile'])
  })

  it('files a reported problem under its source, in the chat it names or under the app', async () => {
    const { test, apps } = await setup()
    apps.problem(U, 'hook', {
      sessionId: 'S1',
      source: 'onRunEnd',
      message: 'the webhook rejected it.',
    })
    apps.problem(U, 'hook', { source: 'register', message: 'no URL is configured', detail: 'cfg' })
    const open = await openRows(test)
    const byTitle = open.sort((a, b) => a.title.localeCompare(b.title))
    expect(byTitle.map((row) => [row.title, row.origin.kind])).toEqual([
      ['No URL is configured', 'application'],
      ['The webhook rejected it', 'session'],
    ])
    // A different problem from the same source replaces its row.
    apps.problem(U, 'hook', { sessionId: 'S1', source: 'onRunEnd', message: 'timed out' })
    expect((await openRows(test)).map((row) => row.title).sort()).toEqual([
      'No URL is configured',
      'Timed out',
    ])
  })

  it('reports a channel crash and a refused backend, each cleared when it works again', async () => {
    const { test, apps } = await setup()
    apps.channelCrashed('chat', 'echo', 'token revoked')
    apps.backendProblems('chat', ['id "x" must be namespaced'])
    expect((await openRows(test)).length).toBe(2)
    apps.channelStarted('chat', 'echo')
    apps.backendProblems('chat', [])
    expect(await openRows(test)).toEqual([])
  })

  it('an app that did not build is one row until the report that no longer names it', async () => {
    const { test, apps } = await setup()
    const reason = 'error: Could not resolve: "left-pad"'
    await apps.stagingFailed([
      { name: 'fresh', reason, lastGoodCopy: false },
      { name: 'weather', reason, lastGoodCopy: true },
    ])
    let open = await openRows(test)
    const described = open.map((row) => [row.title, row.severity, row.body?.includes(reason)])
    expect(described.sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual([
      ['The fresh mini app did not build', 'error', true],
      ['The weather mini app is running its last successful build', 'warning', true],
    ])
    // Not swept by `enabled`: an app that never built is enabled nowhere, and its row must stay.
    await apps.enabled(new Set(['weather']))
    expect((await openRows(test)).length).toBe(2)

    await apps.stagingFailed([{ name: 'weather', reason, lastGoodCopy: true }])
    open = await openRows(test)
    expect(open.map((row) => row.title)).toEqual([
      'The weather mini app is running its last successful build',
    ])
    await apps.stagingFailed([])
    expect(await openRows(test)).toEqual([])
  })
})

describe('ctx.reportProblem, as bound for a load that runs mini app code', () => {
  it('records every problem, and draws it on the transcript only when it names a chat', async () => {
    const { test, apps } = await setup()
    observeMiniAppConditions(apps)
    const drawn: string[] = []
    const report = miniAppProblemReporter(U, (name, problem) =>
      drawn.push(`${name}@${problem.sessionId}`),
    )
    const ctx = makeContext(
      'hook',
      '/p',
      {},
      () => {},
      '/w',
      U,
      join(tmpdir(), 'localix-mini-app-conditions-home'),
      undefined,
      report,
    )
    ctx.reportProblem?.({ sessionId: 'S1', source: 'onRunEnd', message: 'rejected' })
    ctx.reportProblem?.({ source: 'register', message: 'no URL' })
    expect(drawn).toEqual(['hook@S1'])
    expect((await openRows(test)).length).toBe(2)
  })

  it('never throws into the app, even when a sink does', () => {
    const report = miniAppProblemReporter(U, () => {
      throw new Error('firehose down')
    })
    expect(() => report('hook', { sessionId: 'S1', message: 'x' })).not.toThrow()
  })
})

describe('the loader answers for each mini app it loads', () => {
  let dir: string
  const prevBundled = process.env.LOCALIX_BUNDLED_MINI_APPS_DIR
  const on: AvailabilityReader = { effectFor: () => 'allow' }
  const repo = (): CapabilitySourceRepository => ({
    listForScope: async () => [],
    get: async () => null,
    upsert: async () => {
      throw new Error('unused')
    },
    patchConfig: async () => {
      throw new Error('unused')
    },
    remove: async () => {},
  })

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'mini-app-conditions-'))
    process.env.LOCALIX_BUNDLED_MINI_APPS_DIR = await fs.mkdtemp(join(tmpdir(), 'mini-app-cond-b-'))
    const root = join(dir, '.localix', 'mini-apps', 'broken')
    await fs.mkdir(join(root, 'backend'), { recursive: true })
    await fs.writeFile(
      join(root, 'mini-app.json'),
      JSON.stringify({
        name: 'broken',
        version: '1.0.0',
        description: 'd',
        displayName: 'Broken',
        backend: './backend/index.mjs',
      }),
    )
    await fs.writeFile(
      join(root, 'backend', 'index.mjs'),
      'export function register() { throw new Error("missing API key") }\n',
    )
  })
  afterAll(async () => {
    if (prevBundled === undefined) delete process.env.LOCALIX_BUNDLED_MINI_APPS_DIR
    else process.env.LOCALIX_BUNDLED_MINI_APPS_DIR = prevBundled
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('records an app whose register() throws as a failed load', async () => {
    const { test, apps } = await setup()
    observeMiniAppConditions(apps)
    const scope = { availability: on, userId: U, projectId: '', cwd: dir, homeDir: dir }
    await loadEnabledMiniApps({ ...scope, repo: repo() })
    const [row] = await openRows(test)
    expect(row).toMatchObject({ title: 'Could not load the Broken mini app', severity: 'error' })
    expect(row?.body).toContain('missing API key')
  })
})
