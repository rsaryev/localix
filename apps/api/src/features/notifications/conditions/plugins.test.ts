import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AvailabilityReader } from '../../capabilities/availability'
import type { CapabilitySourceRepository } from '../../capabilities/source-repository'
import { loadEnabledPlugins } from '../../plugins/loader'
import { makeContext } from '../../plugins/native'
import { pluginProblemReporter } from '../../plugins/problem-reporter'
import { createPluginConditions, observePluginConditions, recordPluginCatalogLoad } from './plugins'
import { createTestJournal, openRows, TEST_USER as U, type TestJournal } from './test-journal'

const journals: TestJournal[] = []
afterEach(async () => {
  observePluginConditions(undefined)
  await Promise.all(journals.splice(0).map((j) => j.close()))
})

async function setup() {
  const test = await createTestJournal()
  journals.push(test)
  return { test, plugins: createPluginConditions(test.journal, U) }
}

describe('plugin conditions', () => {
  it('a failed load is one row, settles on a clean load, and reopens when it fails again', async () => {
    const { test, plugins } = await setup()
    const failed = {
      name: 'tracker',
      displayName: 'Tracker',
      projectId: '',
      error: 'SyntaxError: x',
    }
    plugins.loaded(U, failed)
    plugins.loaded(U, failed)
    expect((await openRows(test)).map((row) => row.title)).toEqual([
      'Could not load the Tracker plugin',
    ])

    plugins.loaded(U, { name: 'tracker', projectId: '' })
    expect(await openRows(test)).toEqual([])
    plugins.loaded(U, failed)
    expect(await openRows(test)).toMatchObject([
      { occurrenceCount: 2, origin: { label: 'Tracker' } },
    ])
  })

  it('a whole-load failure is one row per workspace, settled by the next load that completes', async () => {
    const { test, plugins } = await setup()
    observePluginConditions(plugins)
    recordPluginCatalogLoad(U, 'P1', new Error('ENOENT: plugins.json'))
    recordPluginCatalogLoad(U, 'P1', new Error('ENOENT: plugins.json'))
    recordPluginCatalogLoad(U, 'P2')
    let open = await openRows(test)
    expect(open.map((row) => [row.title, row.body?.includes('ENOENT')])).toEqual([
      ['Could not load plugins', true],
    ])
    recordPluginCatalogLoad(U, 'P1')
    open = await openRows(test)
    expect(open).toEqual([])
  })

  it('retires every row about a plugin no scope enables any more, and nothing else', async () => {
    const { test, plugins } = await setup()
    plugins.loaded(U, { name: 'gone', projectId: '', error: 'boom' })
    plugins.monitorStopped('gone', 'watch', 'Its command exited with code 1.')
    plugins.loaded(U, { name: 'kept', projectId: '', error: 'boom' })
    plugins.reconciled('catalog unreadable')
    await plugins.enabled(new Set(['kept']))
    const open = (await openRows(test)).map((row) => row.key.split(':').slice(1, 3).join(':'))
    expect(open.sort()).toEqual(['plugin:kept', 'plugins:reconcile'])
  })

  it('files a reported problem under its source, in the chat it names or under the plugin', async () => {
    const { test, plugins } = await setup()
    plugins.problem(U, 'hook', {
      sessionId: 'S1',
      source: 'onRunEnd',
      message: 'the webhook rejected it.',
    })
    plugins.problem(U, 'hook', {
      source: 'register',
      message: 'no URL is configured',
      detail: 'cfg',
    })
    const open = await openRows(test)
    const byTitle = open.sort((a, b) => a.title.localeCompare(b.title))
    expect(byTitle.map((row) => [row.title, row.origin.kind])).toEqual([
      ['No URL is configured', 'application'],
      ['The webhook rejected it', 'session'],
    ])
    // A different problem from the same source replaces its row.
    plugins.problem(U, 'hook', { sessionId: 'S1', source: 'onRunEnd', message: 'timed out' })
    expect((await openRows(test)).map((row) => row.title).sort()).toEqual([
      'No URL is configured',
      'Timed out',
    ])
  })

  it('reports a channel crash and a dead monitor, each cleared by its next start', async () => {
    const { test, plugins } = await setup()
    plugins.channelCrashed('chat', 'echo', 'token revoked')
    plugins.monitorStopped('chat', 'tail', 'Its command ended.')
    plugins.backendProblems('chat', ['id "x" must be namespaced'])
    expect((await openRows(test)).length).toBe(3)
    plugins.channelStarted('chat', 'echo')
    plugins.monitorStarted('chat', 'tail')
    plugins.backendProblems('chat', [])
    expect(await openRows(test)).toEqual([])
  })

  it('a plugin that did not build is one row until the report that no longer names it', async () => {
    const { test, plugins } = await setup()
    const reason = 'error: Could not resolve: "left-pad"'
    await plugins.stagingFailed([
      { name: 'fresh', reason, lastGoodCopy: false },
      { name: 'weather', reason, lastGoodCopy: true },
    ])
    let open = await openRows(test)
    const described = open.map((row) => [row.title, row.severity, row.body?.includes(reason)])
    expect(described.sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual([
      ['The fresh plugin did not build', 'error', true],
      ['The weather plugin is running its last successful build', 'warning', true],
    ])
    // Not swept by `enabled`: a plugin that never built is enabled nowhere, and its row must stay.
    await plugins.enabled(new Set(['weather']))
    expect((await openRows(test)).length).toBe(2)

    await plugins.stagingFailed([{ name: 'weather', reason, lastGoodCopy: true }])
    open = await openRows(test)
    expect(open.map((row) => row.title)).toEqual([
      'The weather plugin is running its last successful build',
    ])
    await plugins.stagingFailed([])
    expect(await openRows(test)).toEqual([])
  })
})

describe('ctx.reportProblem, as bound for a load that runs plugin code', () => {
  it('records every problem, and draws it on the transcript only when it names a chat', async () => {
    const { test, plugins } = await setup()
    observePluginConditions(plugins)
    const drawn: string[] = []
    const report = pluginProblemReporter(U, (name, problem) =>
      drawn.push(`${name}@${problem.sessionId}`),
    )
    const ctx = makeContext(
      'hook',
      '/p',
      {},
      () => {},
      '/w',
      U,
      join(tmpdir(), 'localix-plugin-conditions-home'),
      undefined,
      report,
    )
    ctx.reportProblem?.({ sessionId: 'S1', source: 'onRunEnd', message: 'rejected' })
    ctx.reportProblem?.({ source: 'register', message: 'no URL' })
    expect(drawn).toEqual(['hook@S1'])
    expect((await openRows(test)).length).toBe(2)
  })

  it('never throws into the plugin, even when a sink does', () => {
    const report = pluginProblemReporter(U, () => {
      throw new Error('firehose down')
    })
    expect(() => report('hook', { sessionId: 'S1', message: 'x' })).not.toThrow()
  })
})

describe('the loader answers for each plugin it loads', () => {
  let dir: string
  const prevBundled = process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  const on: AvailabilityReader = { effectFor: () => 'allow' }
  const repo = (): CapabilitySourceRepository => ({
    listForScope: async () => [
      {
        id: 'broken',
        userId: U,
        projectId: '',
        name: 'broken',
        config: {},
        source: 'local',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
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
    dir = await fs.mkdtemp(join(tmpdir(), 'plugin-conditions-'))
    process.env.LOCALIX_BUNDLED_PLUGINS_DIR = await fs.mkdtemp(join(tmpdir(), 'plugin-cond-b-'))
    const root = join(dir, '.localix', 'plugins', 'broken')
    await fs.mkdir(join(root, 'tools'), { recursive: true })
    await fs.writeFile(
      join(root, 'plugin.json'),
      JSON.stringify({ name: 'broken', version: '1.0.0', description: 'd', displayName: 'Broken' }),
    )
    await fs.writeFile(
      join(root, 'tools', 'index.mjs'),
      'export function register() { throw new Error("missing API key") }\n',
    )
  })
  afterAll(async () => {
    if (prevBundled === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
    else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevBundled
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('records a plugin whose register() throws as a failed load', async () => {
    const { test, plugins } = await setup()
    observePluginConditions(plugins)
    const scope = { availability: on, userId: U, projectId: '', cwd: dir, homeDir: dir }
    await loadEnabledPlugins({ ...scope, repo: repo() })
    const [row] = await openRows(test)
    expect(row).toMatchObject({ title: 'Could not load the Broken plugin', severity: 'error' })
    expect(row?.body).toContain('missing API key')
  })
})
