import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { READ_RESULT_TOOLS } from '@localixai/agent'

import type { AvailabilityReader } from '../capabilities/availability'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'
import { trustFallback } from '../ext/trust'
import { loadEnabledMiniApps } from './loader'
import { MINI_APP_TOOL_DESCRIPTION_MAX_CHARS } from './tool-policy'

declare global {
  // eslint-disable-next-line no-var
  var __TEST_MINI_APP_IMPORTS__: number | undefined
  // eslint-disable-next-line no-var
  var __TEST_MINI_APP_REGISTERS__: number | undefined
}

function repo(rows: CapabilitySourceRecord[] = []): CapabilitySourceRepository {
  return {
    listForScope: async () => rows,
    get: async (_u, _p, name) => rows.find((row) => row.name === name) ?? null,
    upsert: async () => {
      throw new Error('unused')
    },
    patchConfig: async () => {
      throw new Error('unused')
    },
    remove: async () => {},
  }
}

const row = (name: string, config: Record<string, string> = {}): CapabilitySourceRecord => ({
  id: name,
  userId: 'u1',
  projectId: '',
  name,
  config,
  source: 'local',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** A rule store naming exactly which mini apps are on; the rest is left to the trust gate. */
const allowing = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name, trust = 'bundled') =>
    names.includes(name) ? 'allow' : trustFallback(trust),
})

let dir: string
const load = (
  availability: AvailabilityReader,
  extra: Partial<Parameters<typeof loadEnabledMiniApps>[0]> = {},
) =>
  loadEnabledMiniApps({
    repo: repo([row('demo', { GREETING: 'hello there' })]),
    availability,
    userId: 'u1',
    projectId: '',
    cwd: dir,
    homeDir: dir,
    ...extra,
  })

/** One mini app: `mini-app.json` and a backend module. */
async function app(name: string, manifest: Record<string, unknown>, backend?: string) {
  const root = join(dir, '.localix', 'mini-apps', name)
  await fs.mkdir(join(root, 'backend'), { recursive: true })
  await fs.writeFile(
    join(root, 'mini-app.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: `${name} fixture`,
      ...(backend ? { backend: './backend/index.mjs' } : {}),
      ...manifest,
    }),
  )
  if (backend) await fs.writeFile(join(root, 'backend', 'index.mjs'), backend)
}

const tool = (name: string, extra = '') =>
  `{ name: "${name}", description: "${name} tool", inputSchema: {}, ${extra} execute: async () => ({ content: "ok" }) }`

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'mini-app-load-'))

  await app(
    'demo',
    {
      config: { GREETING: { type: 'string' } },
      promptSections: [{ title: 'House style', content: 'Say ${GREETING}.' }],
    },
    [
      'globalThis.__TEST_MINI_APP_IMPORTS__ = (globalThis.__TEST_MINI_APP_IMPORTS__ ?? 0) + 1',
      `export function register() { return { tools: [${[tool('hello'), tool('bash'), tool('Bash'), tool('MixedTool')].join(', ')}], hooks: { onSessionStart: () => {} } } }`,
    ].join('\n'),
  )
  await app(
    'probe',
    {},
    [
      'export function register(ctx) {',
      '  return { tools: [{ name: "where", description: "echo cwd", inputSchema: {}, execute: async () => ({ content: ctx.cwd }) }] }',
      '}',
    ].join('\n'),
  )
  await app(
    'verbose',
    {},
    `export function register() { return { tools: [{ name: "verbose_lookup", description: "${'x'.repeat(
      MINI_APP_TOOL_DESCRIPTION_MAX_CHARS + 500,
    )}", inputSchema: {}, execute: async () => ({ content: "ok" }) }] } }`,
  )
  await app(
    'boarder',
    {},
    `export function register() { return { tools: [${tool('work_items', 'roles: ["task-board"],')}] } }`,
  )
  await app(
    'classer',
    {},
    `export function register() { return { tools: [${tool('classy_read', 'contextClass: "readResult",')}] } }`,
  )
  for (const name of ['mem-a', 'mem-b'])
    await app(
      name,
      {},
      `export function register() { return { memory: { loadContext: () => ({ context: 'from ${name}' }) } } }`,
    )
  await app(
    'counted',
    { config: { GREETING: { type: 'string' } } },
    [
      'export function register() {',
      '  globalThis.__TEST_MINI_APP_REGISTERS__ = (globalThis.__TEST_MINI_APP_REGISTERS__ ?? 0) + 1',
      '  return { tools: [{ name: "counted_tool", description: "x", inputSchema: {}, execute: async () => ({ content: "ok" }) }] }',
      '}',
    ].join('\n'),
  )
  await app(
    'decider',
    {},
    [
      'export function register(ctx) {',
      '  return { tools: [{ name: "decider_pick", description: "x", inputSchema: {}, execute: async (_id, _input, _signal, _update, context) => {',
      '    if (!ctx.decisions) return { content: "no decision model" }',
      '    const outcome = await ctx.decisions.decide(ctx.userId, { state: {}, questions: {} }, { purpose: "pick", sessionId: context.session.id })',
      '    return { content: `${outcome.status} by ${outcome.model}` }',
      '  } }] }',
      '}',
    ].join('\n'),
  )
  await app('guided', {})
  await fs.writeFile(join(dir, '.localix', 'mini-apps', 'guided', 'guide.md'), '# Guided\n')
})

afterAll(async () => {
  delete globalThis.__TEST_MINI_APP_IMPORTS__
  delete globalThis.__TEST_MINI_APP_REGISTERS__
  await fs.rm(dir, { recursive: true, force: true })
})

describe('loadEnabledMiniApps', () => {
  it('loads backend tools from an enabled app and drops reserved names', async () => {
    const loaded = await load(allowing('demo'))
    expect(loaded.tools.map((t) => t.name)).toEqual(['hello'])
    expect(loaded.loaded.find((entry) => entry.name === 'demo')?.toolNames).toEqual(['hello'])
    expect(loaded.hooks.map((hook) => hook.app)).toEqual(['demo'])
  })

  it('imports no code of an app nothing switched on (the trust gate)', async () => {
    globalThis.__TEST_MINI_APP_IMPORTS__ = 0
    const loaded = await load(allowing())
    expect(loaded.tools).toHaveLength(0)
    expect(loaded.loaded).toHaveLength(0)
    expect(globalThis.__TEST_MINI_APP_IMPORTS__).toBe(0)
    expect(loaded.awaitingConsent).toContain('demo')
  })

  it("registers a tool's contextClass with the context machinery, naming no tool in core", async () => {
    expect(READ_RESULT_TOOLS.has('classy_read')).toBe(false)
    await load(allowing('classer'))
    expect(READ_RESULT_TOOLS.has('classy_read')).toBe(true)
  })

  // The host finds its task board by role (board rules, Claude Code's task hooks), never by name:
  // a role a mini app's tool declares must survive loading, or the board silently goes unseen.
  it("keeps the roles a mini app's tool declares", async () => {
    const loaded = await load(allowing('boarder'))
    expect(loaded.tools.find((t) => t.name === 'work_items')?.roles).toEqual(['task-board'])
  })

  // `register()` used to run on every turn: a backend that opens a watcher or a socket there
  // opened another one per message, and a turn paid every backend's start-up again.
  it('runs register() once per scope while the backend and its settings stand', async () => {
    const registers = () => globalThis.__TEST_MINI_APP_REGISTERS__ ?? 0
    const settings = (greeting: string) => ({
      repo: repo([row('counted', { GREETING: greeting })]),
    })
    await load(allowing('counted'), settings('hi'))
    const first = registers()
    const again = await load(allowing('counted'), settings('hi'))
    expect(registers()).toBe(first)
    expect(again.tools.map((t) => t.name)).toEqual(['counted_tool'])
    // Another project is another scope: its own context, its own register().
    await load(allowing('counted'), { ...settings('hi'), projectId: 'p2' })
    expect(registers()).toBe(first + 1)
    // Changed settings are a new revision of the same scope.
    await load(allowing('counted'), settings('hello'))
    expect(registers()).toBe(first + 2)
  })

  // A tool's load used to carry no decision model: `decide` in a tool answered `unavailable` in
  // every chat, while the same call from the app's route reached the model.
  it("hands a tool's load the decision model, bound to its app, for the chat that calls it", async () => {
    const loaded = await load(allowing('decider'), {
      decisionsFor: (miniApp) => ({
        available: async () => ({ model: 'jev' }),
        decide: async (_userId, _ask, options) => ({
          status: 'answered',
          model: `${miniApp} in ${options.sessionId}`,
          ms: 1,
          answers: {},
        }),
      }),
    })
    const pick = loaded.tools.find((t) => t.name === 'decider_pick')!
    const result = await pick.execute('c', {}, undefined, undefined, {
      session: { id: 'chat-1' },
    } as never)
    expect(result.content).toBe('answered by decider in chat-1')
  })

  it('passes the session cwd to register(ctx)', async () => {
    const loaded = await load(allowing('probe'))
    const where = loaded.tools.find((t) => t.name === 'where')
    expect((await where!.execute('c', {})).content).toBe(dir)
  })

  it('caps an oversized tool description before it reaches the model', async () => {
    const warnings: string[] = []
    const loaded = await load(allowing('verbose'), {
      logger: { warn: (message) => warnings.push(message) },
    })
    const lookup = loaded.tools.find((candidate) => candidate.name === 'verbose_lookup')
    expect(lookup?.description).toHaveLength(MINI_APP_TOOL_DESCRIPTION_MAX_CHARS)
    expect(warnings.some((warning) => warning.includes('description capped'))).toBe(true)
  })

  it('fills a prompt section from the app’s settings, attributed to the app', async () => {
    const loaded = await load(allowing('demo'))
    expect(loaded.promptSections).toEqual([
      { app: 'demo', title: 'House style', content: 'Say hello there.' },
    ])
    expect((await load(allowing())).promptSections).toEqual([])
  })

  it('collects the guide of an enabled app, and none for one without', async () => {
    const loaded = await load(allowing('guided', 'demo'))
    expect(loaded.guides.map((guide) => guide.app)).toEqual(['guided'])
  })

  it('only the first enabled memory provider is active; the second is ignored with a warning', async () => {
    const warnings: string[] = []
    const loaded = await load(allowing('mem-a', 'mem-b'), {
      logger: { warn: (m) => warnings.push(m) },
    })
    expect(loaded.memory?.app).toBe('mem-a')
    expect(warnings.some((w) => w.includes('memory provider ignored'))).toBe(true)
    expect((await load(allowing())).memory).toBeNull()
  })

  it('reports what the load cost, once, and only to a logger that takes info', async () => {
    const lines: Array<{ msg: string; meta: unknown }> = []
    await load(allowing('demo'), {
      logger: { warn: () => {}, info: (msg, meta) => lines.push({ msg, meta }) },
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]!.meta).toMatchObject({ event: 'mini_apps.loaded', apps: 1 })
  })
})
