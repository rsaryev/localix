import { describe, expect, test } from 'bun:test'
import { createHumanInLoopController } from '@localixai/agent/agents'
import type { InstallPlan, Listing } from '@localixai/store'
import { makeListing, makeListingDetail } from '@localixai/store/testing'

import { evaluate } from '../permission-engine'
import { extractCallFacts } from '../permission-facts'
import { createStoreTool, classifyStoreCall, type StoreToolPort } from './store'

const plan = (over: Partial<InstallPlan> = {}): InstallPlan => ({
  scope: 'user',
  adds: [{ kind: 'skill', name: 'review' }],
  runs: [{ kind: 'hook', name: 'fmt', command: 'prettier --write' }],
  network: ['api.example.test'],
  requires: [],
  warnings: ['It runs programs on this computer'],
  needsConsent: true,
  ...over,
})

/** A port that records every call it is made. */
function harness(over: Partial<StoreToolPort> = {}) {
  const calls: unknown[][] = []
  const record =
    <T>(name: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return value
    }
  const port: StoreToolPort = {
    search: record('search', [] as Listing[]),
    detail: record('detail', makeListingDetail(makeListing({ id: 'review', kind: 'plugin' }))),
    plan: record('plan', plan()),
    install: record('install', undefined),
    update: record('update', undefined),
    remove: record('remove', undefined),
    setEnabled: record('setEnabled', undefined),
    create: record('create', { kind: 'agent' as const, id: 'native:qa' }),
    ...over,
  }
  const tool = createStoreTool(port)
  const humanInLoop = createHumanInLoopController()
  const context = { humanInLoop, interactive: true }
  const run = (input: unknown, ctx: object | null = context) =>
    tool.execute('call-1', input as never, undefined, undefined, (ctx ?? undefined) as never)
  /** What the person sees, and a way to answer it. */
  const card = () =>
    humanInLoop.listPending()[0]?.request as
      | { kind: string; title: string; payload: { command: string } }
      | undefined
  const answer = (confirmed: boolean) => {
    const pending = humanInLoop.listPending()[0]!.request
    humanInLoop.respond({
      requestId: pending.id,
      kind: 'confirm',
      payload: { answers: { confirmed } },
      respondedAt: Date.now(),
    })
  }
  return { tool, calls, run, card, answer, humanInLoop }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const review = { kind: 'plugin', id: 'review@market' } as const

describe('store tool: reading', () => {
  test('search returns compact cards with the install state the Store holds', async () => {
    const installed = makeListing({
      id: 'kanban',
      installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
    })
    const { tool, calls, run } = harness({
      search: async (query) => {
        calls.push(['search', query])
        return [installed]
      },
    })
    const result = await run({ action: 'search', query: 'board', installed: true })
    expect(calls).toEqual([['search', { query: 'board', installed: true, limit: 10 }]])
    const [card] = JSON.parse(String(result.content)).results
    expect(card).toMatchObject({
      ref: { kind: 'mini-app', id: 'kanban' },
      kind: 'mini-app',
      installs: [{ scope: 'user', version: '1.0.0', enabled: true }],
      updateTo: '1.1.0',
    })
    expect(card.publisher).toBeDefined()
    expect(tool.inputSchema.safeParse({ action: 'search', sources: 'x' }).success).toBe(false)
  })

  test('get returns the detail summary and the install plan', async () => {
    const { run, calls } = harness()
    const result = await run({ action: 'get', ref: review })
    expect(calls.map((call) => call[0])).toEqual(['detail', 'plan'])
    const body = JSON.parse(String(result.content))
    expect(body.plan).toMatchObject({
      adds: [{ kind: 'skill', name: 'review' }],
      runs: [{ kind: 'hook', name: 'fmt', command: 'prettier --write' }],
      network: ['api.example.test'],
      warnings: ['It runs programs on this computer'],
      needsConsent: true,
    })
    expect(body.ref).toEqual({ kind: 'plugin', id: 'review' })
  })

  test('get of a kind that is made here, not installed, carries no plan', async () => {
    const { run } = harness({
      plan: async () => {
        throw new Error('Agents cannot be installed')
      },
    })
    const body = JSON.parse(
      String((await run({ action: 'get', ref: { kind: 'agent', id: 'a' } })).content),
    )
    expect(body.plan).toBeNull()
  })
})

describe('store tool: install asks, and installs only after approval', () => {
  test('the person sees the plan; consent goes to the Store only once they approve', async () => {
    const { run, calls, card, answer } = harness()
    const pending = run({ action: 'install', ref: review, scope: 'user' })
    await tick()
    const shown = card()!
    expect(shown.kind).toBe('confirm')
    expect(shown.title).toContain('review@market')
    for (const line of ['prettier --write', 'api.example.test', 'It runs programs'])
      expect(shown.payload.command).toContain(line)
    expect(calls.map((call) => call[0])).toEqual(['plan'])
    answer(true)
    const result = await pending
    expect(calls.at(-1)).toEqual(['install', review, 'user', { plan: true }])
    expect(result.isError).toBeUndefined()
    expect(String(result.content)).toContain('started')
    expect(String(result.content)).toContain('get')
  })

  test('a declined plan installs nothing and tells the model not to ask again', async () => {
    const { run, calls, answer } = harness()
    const pending = run({ action: 'install', ref: review, scope: 'project' })
    await tick()
    answer(false)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(String(result.content)).toContain('declined')
    expect(calls.map((call) => call[0])).toEqual(['plan'])
  })

  test('a run that cannot confirm refuses every mutating action and touches nothing', async () => {
    const { run, calls } = harness()
    for (const input of [
      { action: 'install', ref: review, scope: 'user' },
      { action: 'update', ref: review, scope: 'user' },
      { action: 'remove', ref: review, scope: 'user' },
      { action: 'enable', ref: review, scope: 'user' },
      { action: 'disable', ref: review, scope: 'user' },
      { action: 'create', kind: 'agent', scope: 'user', values: { name: 'qa', description: 'd' } },
    ]) {
      for (const ctx of [null, { humanInLoop: harness().humanInLoop, interactive: false }]) {
        const result = await run(input, ctx)
        expect(result.isError).toBe(true)
        expect(String(result.content)).toContain('No person can approve')
      }
    }
    expect(calls).toEqual([])
  })

  test('a mutating call names its scope; a guess would remove the wrong install', async () => {
    const { run, calls } = harness()
    const result = await run({ action: 'remove', ref: review })
    expect(result.isError).toBe(true)
    expect(String(result.content)).toContain('scope')
    expect(calls).toEqual([])
  })
})

describe('store tool: the other changes', () => {
  test.each([
    ['update', ['update', review, 'user'], 'started'],
    ['remove', ['remove', review, 'user'], 'Removed'],
    ['enable', ['setEnabled', review, 'user', true], 'Enabled'],
    ['disable', ['setEnabled', review, 'user', false], 'Disabled'],
  ] as const)('%s asks, then does it through the Store', async (action, expected, word) => {
    const { run, calls, card, answer } = harness()
    const pending = run({ action, ref: review, scope: 'user' })
    await tick()
    expect(card()!.title.toLowerCase()).toContain(action)
    answer(true)
    const result = await pending
    expect(calls).toEqual([[...expected]])
    expect(String(result.content)).toContain(word)
  })

  test('create writes an agent with its instructions, once approved', async () => {
    const { run, calls, card, answer } = harness()
    const values = { name: 'qa', description: 'Tests', instructions: 'Run the suite.' }
    const pending = run({ action: 'create', kind: 'agent', scope: 'project', values })
    await tick()
    expect(card()!.payload.command).toContain('Run the suite.')
    answer(true)
    const result = await pending
    expect(calls).toEqual([['create', 'agent', 'project', values]])
    expect(String(result.content)).toContain('native:qa')
  })

  test('a Store refusal comes back as an error result, not a throw', async () => {
    const { run, answer } = harness({
      remove: async () => {
        throw new Error('This comes from elsewhere')
      },
    })
    const pending = run({ action: 'remove', ref: review, scope: 'user' })
    await tick()
    answer(true)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(String(result.content)).toContain('This comes from elsewhere')
  })

  test('the schema has no source or marketplace actions', () => {
    const { tool } = harness()
    for (const action of ['add_source', 'remove_source', 'refresh', 'sources'])
      expect(tool.inputSchema.safeParse({ action }).success).toBe(false)
  })
})

describe('store tool: the permission gate', () => {
  test('reads are reads; every change is a host effect that waits on a person', () => {
    expect(classifyStoreCall({ action: 'search' })).toEqual({ effect: 'read' })
    expect(classifyStoreCall({ action: 'get' })).toEqual({ effect: 'read' })
    for (const action of ['install', 'update', 'enable', 'disable', 'create'])
      expect(classifyStoreCall({ action })).toEqual({ effect: 'host', needsHuman: true })
    expect(classifyStoreCall({ action: 'remove' })).toEqual({
      effect: 'host',
      needsHuman: true,
      irreversible: true,
    })
    expect(classifyStoreCall({ action: 'sources' })).toEqual({ effect: 'external' })
  })

  test('a rule can allow reads and deny changes, or deny one package', () => {
    const { tool } = harness()
    const rules = [
      { permission: 'store', pattern: '*', action: 'deny' as const },
      { permission: 'store', pattern: 'search', action: 'allow' as const },
    ]
    const verdict = (input: { action: string }) =>
      evaluate(
        rules,
        { name: 'store', ...classifyStoreCall(input) },
        extractCallFacts('store', input, undefined, tool),
      ).action
    expect(verdict({ action: 'search' })).toBe('allow')
    expect(verdict({ action: 'install', ref: review, scope: 'user' } as never)).toBe('deny')
    const facts = extractCallFacts(
      'store',
      { action: 'install', ref: review, scope: 'user' },
      undefined,
      tool,
    )
    expect(facts.resources).toEqual(['install:plugin:review@market:user'])
  })

  test('reads overlap other reads; changes are a barrier', () => {
    const { tool } = harness()
    expect(tool.executionModeFor?.({ action: 'search' })).toBe('parallel')
    expect(tool.executionModeFor?.({ action: 'install' })).toBe('sequential')
  })
})
