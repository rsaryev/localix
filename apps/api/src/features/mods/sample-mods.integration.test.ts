import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import { createScriptVms } from '@localixai/engine-scripts'
import { tempDirPerTest } from '@localixai/testing'
import { INERT_MOD_PORTS, type ModScene, type ModSource, type ModsPorts } from './contracts'
import { createModsHost } from './host'
import { createModRunScope } from './run-scope'

/**
 * Mods written for Claude Code 2.1.310, run unchanged in Localix's host, each in its VM: Token
 * Weather, Next Steps, Replay Theater and Blast Radius, read from where they are checked out on
 * this machine (`LOCALIX_SAMPLE_MODS`, else the playground under the Localix workspace). Skipped
 * where they are not; nothing of theirs is copied into this repository.
 */

const PLAYGROUND =
  process.env.LOCALIX_SAMPLE_MODS ??
  join(homedir(), '.localix/workspace/LOCALIX-316/claude-code-playground/claude-code/mods')
const NEXT_STEPS = process.env.LOCALIX_NEXT_STEPS ?? join(homedir(), '.localix/plugins/next-steps')

const MODS: Record<string, string> = {
  'token-weather': join(PLAYGROUND, 'token-weather/hooks/token-weather.mjs'),
  'replay-theater': join(PLAYGROUND, 'replay-theater/hooks/replay-theater.mjs'),
  'blast-radius': join(PLAYGROUND, 'blast-radius/hooks/blast-radius.mjs'),
  'next-steps': join(NEXT_STEPS, 'hooks/register.tsx'),
}
const present = Object.values(MODS).every((module) => existsSync(module))

const scratch = tempDirPerTest('sample-mods', {})
const vms = createScriptVms()

const labelText = (label: unknown): string => (typeof label === 'string' ? label : '')

/** Text anywhere in a drawing. */
const textOf = (nodes: unknown): string =>
  Array.isArray(nodes)
    ? nodes.map(textOf).join('')
    : typeof nodes === 'string'
      ? nodes
      : nodes && typeof nodes === 'object'
        ? [
            labelText((nodes as { props?: { label?: unknown } }).props?.label),
            textOf((nodes as { children?: unknown }).children),
          ].join('')
        : ''

/** Wait, a real while, for what a mod does on its own (a fork, a timer). */
async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let tries = 0; tries < 100; tries++) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function start(plugin: string, ports: Partial<ModsPorts> = {}) {
  const dir = scratch()
  const module = MODS[plugin]!
  const root = join(module, '../..')
  const host = createModsHost(
    { ...INERT_MOD_PORTS, dataDir: (name) => join(dir, 'data', name), workspaceDir: dir, ...ports },
    { vms },
  )
  const source: ModSource = { plugin, root, module, options: {}, revision: '1' }
  await host.reconcile([source])
  expect(host.failures().get(plugin)).toBeUndefined()
  const scene: ModScene = { userId: 'u', sessionId: 's1', cwd: dir }
  const scope = await createModRunScope(host, scene, new Set([plugin]), { model: 'model-a' })
  const band = async () => (await host.band.render('s1', { columns: 100, rows: 12 })).tree
  return { host, scope, dir, band }
}

const tool = (name: string, run: (input: Record<string, unknown>) => string) =>
  defineAgentTool({
    name,
    description: name,
    activeVerb: 'Running',
    inputSchema: z.object({}).passthrough(),
    execute: async (_id, input) => ({ content: run(input as Record<string, unknown>) }),
  }) as AgentTool

describe.skipIf(!present)('Claude Code’s sample mods, unchanged', () => {
  test('Token Weather draws the context window’s forecast in the band', async () => {
    const { band } = await start('token-weather', {
      readSession: async () => ({
        messages: [],
        model: 'm',
        context: { tokens: 60_000, window: 200_000 },
      }),
    })
    const drawn = await until(async () => (await band()) ?? undefined, 'the forecast')
    expect(textOf(drawn)).toContain('Cloudy')
    expect(textOf(drawn)).toContain('30% of context')
  })

  test('Next Steps offers 1/2/3 after a turn; a press fills the prompt box', async () => {
    const { host, scope, band } = await start('next-steps', {
      readSession: async () => ({
        messages: [{ role: 'user', text: 'Fix the parser', toolUses: [] }],
        model: 'm',
      }),
      complete: async () => ({
        isAnswered: true,
        text: '[{"label":"Run the tests","prompt":"Run the parser tests"},{"label":"Commit","prompt":"Commit the fix"}]',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      }),
    })
    await scope.turnStart('Fix the parser', 't1')
    const answer =
      'I fixed the parser: the tokenizer now handles nested brackets, and the tests pass.'
    await scope.turnComplete({ answer, turnId: 't1', durationMs: 1, reason: 'answer' })
    const offered = await until(async () => {
      const tree = await band()
      return tree && textOf(tree).includes('Run the tests') ? tree : undefined
    }, 'the suggestions')
    expect(textOf(offered)).toContain('next:')
    expect(JSON.stringify(offered)).toContain('"hotkey":"1"')
    expect(await host.band.interact('s1', { kind: 'press', element: 'Run the tests' })).toBe(true)
    await until(
      async () => (host.composer.view('s1').fills.length > 0 ? true : undefined),
      'the fill',
    )
    expect(host.composer.view('s1').fills[0]?.text).toBe('Run the parser tests')
    expect(host.composer.view('s1').suggestion).toBe('Run the parser tests')
  })

  test('Replay Theater records a turn’s edits, hints in the band, and steps through them in a pane', async () => {
    const { host, scope, band } = await start('replay-theater')
    const write = tool('write', () => 'Wrote 1 file')
    const [wrapped] = scope.wrapTools([write])
    await scope.turnStart('Write two notes', 't1')
    await wrapped!.execute('w1', {
      files: [
        { path: 'a.md', content: 'one\n' },
        { path: 'b.md', content: 'two\n' },
      ],
    })
    await scope.turnComplete({ answer: 'Done.', turnId: 't1', durationMs: 1, reason: 'answer' })
    const hint = await until(async () => (await band()) ?? undefined, 'the hint')
    expect(textOf(hint)).toContain('Replay: 2 edits')
    expect(await host.band.interact('s1', { kind: 'press', element: 'open-replay' })).toBe(true)
    const pane = await until(
      async () => host.registry.panes().find((open) => open.id === 'replay-theater'),
      'the pane',
    )
    expect(pane.focusRequest).toBe(1)
    const first = await host.panes.render(pane.instance, 'replay-theater')
    expect(textOf(first?.tree)).toContain('step 1 of 2')
    await host.panes.interact(pane.instance, 'replay-theater', { kind: 'press', element: 'next' })
    const second = await host.panes.render(pane.instance, 'replay-theater')
    expect(textOf(second?.tree)).toContain('step 2 of 2')
    expect(JSON.stringify(second?.tree)).toContain('"hotkey":"p"')
  })

  test('Blast Radius holds rm -rf on its pane until Cancel, and lets go when the turn stops', async () => {
    const { host, scope, dir } = await start('blast-radius')
    mkdirSync(join(dir, 'build'))
    writeFileSync(join(dir, 'build/out.js'), 'x')
    let ran = 0
    const [bash] = scope.wrapTools([tool('bash', () => (ran++, 'removed'))])
    const held = bash!
      .execute('b1', { command: 'rm -rf build' })
      .catch((error: Error) => error.message)
    const pane = await until(
      async () => host.registry.panes().find((open) => open.id === 'blast-radius'),
      'the hold',
    )
    const drawn = await until(async () => {
      const drawing = await host.panes.render(pane.instance, 'blast-radius')
      return textOf(drawing?.tree).includes('Proceed') ? drawing : undefined
    }, 'the report')
    expect(textOf(drawn?.tree)).toContain('delete 1 file')
    await host.panes.interact(pane.instance, 'blast-radius', { kind: 'press', element: 'cancel' })
    expect(await held).toContain('the user pressed Cancel')
    expect(ran).toBe(0)

    const stop = new AbortController()
    const stopped = bash!
      .execute('b2', { command: 'rm -rf build' }, stop.signal)
      .catch((error: Error) => error.message)
    await until(
      async () => host.registry.panes().find((open) => open.id === 'blast-radius'),
      'the second hold',
    )
    stop.abort()
    // The turn stopped: the held call is abandoned, and the command never runs.
    expect(typeof (await stopped)).toBe('string')
    expect(ran).toBe(0)
  }, 30_000)
})
