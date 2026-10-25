import { afterEach, expect, test } from 'bun:test'
import { createHumanInLoopController } from '@localixai/agent/agents'
import type { StoreProvider } from '@localixai/store'

import { runPolicyFixture } from '../../../../testing/run-policy-fixture'
import { sessionFixture } from '../../../../testing/session-fixture'
import { CHAT_RUN_PROFILE, resolveRunProfile } from '../../../agent-core/run-shape'
import { createStoreTool } from '../../../agent-core/tools/store'
import { fakeProvider, makeListing } from '../../../store/testing/fake-provider'
import { makeStore } from '../../../store/testing/store'
import { buildStoreOptions } from './store-options'
import type { RuntimeToolWiringContext, buildRunToolRegistry } from './runtime-tools'

let open: ReturnType<typeof makeStore> | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

const actor = {
  agentId: 'builtin:localix',
  handle: 'localix',
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'high' as const,
}

/** The model's side: the `store` tool built the way a chat run builds it, over a real Store. */
function setup(providers: StoreProvider[], opts: { profile?: typeof CHAT_RUN_PROFILE } = {}) {
  open = makeStore(providers)
  const session = sessionFixture({ projectId: 'p', agents: [actor] })
  const ctx = { deps: { store: open.store } } as unknown as RuntimeToolWiringContext
  const params = {
    userId: 'u1',
    agentId: actor.agentId,
    session,
    policy: runPolicyFixture(session, actor.agentId),
    agentProfile: opts.profile ?? CHAT_RUN_PROFILE,
  } as Parameters<typeof buildRunToolRegistry>[1]
  const port = buildStoreOptions(ctx, params)
  const humanInLoop = createHumanInLoopController()
  const call = (input: unknown, interactive = true) =>
    createStoreTool(port!).execute('call-1', input as never, undefined, undefined, {
      humanInLoop,
      interactive,
    } as never)
  const approve = async (confirmed: boolean) => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const pending = humanInLoop.listPending()[0]!.request
    humanInLoop.respond({
      requestId: pending.id,
      kind: 'confirm',
      payload: { answers: { confirmed } },
      respondedAt: Date.now(),
    })
    return pending as { title: string; payload: { command: string } }
  }
  return { port, call, approve, session }
}

const kanban = makeListing({
  id: 'kanban',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})
const chess = makeListing({ id: 'chess' })
const review = makeListing({ id: 'review@market', kind: 'plugin' })
const results = (result: { content: unknown }) => JSON.parse(String(result.content)).results

test('search returns what the Store screen lists, with each package’s install state', async () => {
  const apps = fakeProvider('mini-app', [chess, kanban])
  const plugins = fakeProvider('plugin', [review])
  const { call } = setup([apps.provider, plugins.provider])
  const all = results(await call({ action: 'search' }))
  expect(all.map((card: { ref: { id: string } }) => card.ref.id).sort()).toEqual([
    'chess',
    'kanban',
    'review@market',
  ])
  expect(all.find((card: { ref: { id: string } }) => card.ref.id === 'kanban')).toMatchObject({
    installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
    updateTo: '1.1.0',
  })
  const onlyPlugins = results(await call({ action: 'search', kind: 'plugin' }))
  expect(onlyPlugins.map((card: { ref: { id: string } }) => card.ref.id)).toEqual(['review@market'])
  const installed = results(await call({ action: 'search', installed: true }))
  expect(installed.map((card: { ref: { id: string } }) => card.ref.id)).toEqual(['kanban'])
})

test('get returns the plan the Store computes for the open project’s scope', async () => {
  const plugins = fakeProvider('plugin', [review])
  const { call } = setup([plugins.provider])
  const body = JSON.parse(
    String(
      (
        await call({
          action: 'get',
          ref: { kind: 'plugin', id: 'review@market' },
          scope: 'project',
        })
      ).content,
    ),
  )
  expect(body.plan).toMatchObject({ scope: 'project', needsConsent: false })
  expect(body.plan.warnings).toEqual(['plan for review@market'])
})

test('a consent-needing install asks with the plan, and the Store hears the consent only after approval', async () => {
  const plugins = fakeProvider('plugin', [review])
  const provider: StoreProvider = {
    ...plugins.provider,
    plan: async (id, scope) => ({
      scope,
      adds: [],
      runs: [{ kind: 'hook', name: 'fmt', command: 'fmt --all' }],
      network: [],
      requires: [],
      warnings: ['It runs programs on this computer'],
      needsConsent: true,
    }),
    install: async (id, scope, consent) => {
      if (!consent.plan) throw new Error('consent required')
      plugins.calls.push(`install ${id} ${scope} ${consent.plan}`)
    },
  }
  const { call, approve } = setup([provider])
  const pending = call({
    action: 'install',
    ref: { kind: 'plugin', id: 'review@market' },
    scope: 'user',
  })
  const card = await approve(true)
  expect(card.payload.command).toContain('fmt --all')
  const result = await pending
  expect(result.isError).toBeUndefined()
  expect(plugins.calls).toContain('install review@market user true')

  const declined = call({
    action: 'install',
    ref: { kind: 'plugin', id: 'review@market' },
    scope: 'user',
  })
  await approve(false)
  expect((await declined).isError).toBe(true)
  expect(plugins.calls.filter((c) => c.startsWith('install'))).toHaveLength(1)
})

test('an unattended run installs nothing', async () => {
  const plugins = fakeProvider('plugin', [review])
  const { call } = setup([plugins.provider])
  const result = await call(
    { action: 'install', ref: { kind: 'plugin', id: 'review@market' }, scope: 'user' },
    false,
  )
  expect(result.isError).toBe(true)
  expect(plugins.calls.some((c) => c.startsWith('install'))).toBe(false)
})

test('remove, enable and disable reach the provider once approved', async () => {
  const apps = fakeProvider('mini-app', [kanban])
  const { call, approve } = setup([apps.provider])
  const ref = { kind: 'mini-app', id: 'kanban' }
  for (const [action, recorded] of [
    ['disable', 'enable kanban user false'],
    ['enable', 'enable kanban user true'],
    ['remove', 'remove kanban user'],
  ] as const) {
    const pending = call({ action, ref, scope: 'user' })
    await approve(true)
    expect((await pending).isError).toBeUndefined()
    expect(apps.calls).toContain(recorded)
  }
})

test('create writes an agent’s instructions after the form’s own fields, and undoes a half-made one', async () => {
  const made: string[] = []
  let failSave = false
  const agentProvider: StoreProvider = {
    ...fakeProvider('agent', [], { madeHere: true }).provider,
    createFields: async () => ({
      fields: [
        { key: 'name', label: 'Name', type: 'string', required: true, secret: false },
        { key: 'description', label: 'Description', type: 'string', required: true, secret: false },
      ],
      scopes: ['user', 'project'],
      noun: 'agent',
    }),
    create: async (scope, values) => {
      made.push(`create ${scope} ${JSON.stringify(values)}`)
      return { kind: 'agent', id: 'native:qa' }
    },
    setConfig: async (id, scope, values) => {
      if (failSave) throw new Error('disk full')
      made.push(`config ${id} ${scope} ${JSON.stringify(values)}`)
    },
    remove: async (id, scope) => void made.push(`remove ${id} ${scope}`),
  }
  const { call, approve } = setup([agentProvider])
  const values = { name: 'qa', description: 'Tests', instructions: 'Run the suite.' }
  const pending = call({ action: 'create', kind: 'agent', scope: 'project', values })
  await approve(true)
  expect((await pending).isError).toBeUndefined()
  expect(made).toEqual([
    'create project {"name":"qa","description":"Tests"}',
    'config native:qa project {"instructions":"Run the suite."}',
  ])

  made.length = 0
  failSave = true
  const broken = call({ action: 'create', kind: 'agent', scope: 'user', values })
  await approve(true)
  const result = await broken
  expect(result.isError).toBe(true)
  expect(made).toEqual(['create user {"name":"qa","description":"Tests"}', 'remove native:qa user'])
})

test('child, automation and non-root hosts never acquire the Store', () => {
  const ctx = { deps: { store: {} } } as unknown as RuntimeToolWiringContext
  for (const sessionKind of ['subagent', 'job', 'chat'] as const) {
    const session = { ...sessionFixture({ sessionKind }), provenance: { kind: 'delegated' } }
    const params = {
      session,
      policy: runPolicyFixture(session as never),
      agentProfile: resolveRunProfile({ sessionKind }),
    } as unknown as Parameters<typeof buildRunToolRegistry>[1]
    expect(buildStoreOptions(ctx, params)).toBeUndefined()
  }
})

test('a root chat gets the port only when the host composed a Store', () => {
  const session = sessionFixture({ projectId: 'p', agents: [actor] })
  const params = {
    userId: 'u1',
    agentId: actor.agentId,
    session,
    policy: runPolicyFixture(session, actor.agentId),
    agentProfile: CHAT_RUN_PROFILE,
  } as Parameters<typeof buildRunToolRegistry>[1]
  const composed = { deps: { store: {} } } as unknown as RuntimeToolWiringContext
  expect(buildStoreOptions(composed, params)).toBeDefined()
  expect(buildStoreOptions({ deps: {} } as never, params)).toBeUndefined()
})
