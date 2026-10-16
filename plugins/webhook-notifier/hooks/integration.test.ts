import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { createHmac } from 'node:crypto'
import { join, resolve } from 'node:path'

import {
  makeHelpers,
  type PluginContext,
  type PluginHooks,
} from '../../../apps/api/src/features/plugins/native'

/**
 * Behavior tests for the bundled `webhook-notifier` plugin (plugins/webhook-notifier):
 * lifecycle hooks POST `{ event, sessionId, ts, payload }` to the configured URL.
 * Imported directly — same module the loader imports when enabled.
 */

const PLUGIN_DIR = resolve(import.meta.dir, '..')

interface CapturedCall {
  url: string
  init: { method: string; headers: Record<string, string>; body: string }
}

const calls: CapturedCall[] = []
const logs: string[] = []
let fetchImpl: (url: string, init: CapturedCall['init']) => Promise<unknown> = async (
  url,
  init,
) => {
  calls.push({ url, init })
  return new Response('ok')
}

const realFetch = globalThis.fetch
// @ts-expect-error test stub narrows the fetch signature
globalThis.fetch = (url: string, init: CapturedCall['init']) => fetchImpl(url, init)
afterAll(() => {
  globalThis.fetch = realFetch
})

async function load(
  config: Record<string, string | number> = {},
  extra: Partial<PluginContext> = {},
): Promise<PluginHooks> {
  const ctx = {
    ...extra,
    pluginName: 'webhook-notifier',
    pluginDir: PLUGIN_DIR,
    cwd: process.cwd(),
    config: { WEBHOOK_URL: 'https://hooks.example.com/x', ...config },
    log: (msg: string) => logs.push(msg),
    helpers: makeHelpers(),
  } as unknown as PluginContext
  const mod = await import(join(PLUGIN_DIR, 'hooks', 'index.mjs'))
  return mod.register(ctx).hooks as PluginHooks
}

// Poll until the fire-and-forget webhook delivery satisfies `done` — a fixed
// delay flakes under CPU load when the async POST hasn't landed yet. ~3s cap.
const settle = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await new Promise((r) => setTimeout(r, 15))
}

beforeEach(() => {
  calls.length = 0
  logs.length = 0
  fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response('ok')
  }
})

describe('webhook-notifier plugin', () => {
  it('POSTs JSON { event, sessionId, ts, payload } for lifecycle events', async () => {
    const hooks = await load()
    await hooks.onSessionEnd!({ sessionId: 's1' })
    await hooks.onSubagentStop!({
      sessionId: 's1',
      childSessionId: 'c1',
      status: 'completed',
      durationMs: 42,
      summary: 'done',
    })
    await settle(() => calls.length >= 2)
    expect(calls.length).toBe(2)
    expect(calls[0].url).toBe('https://hooks.example.com/x')
    const first = JSON.parse(calls[0].init.body)
    expect(first.event).toBe('session_end')
    expect(first.sessionId).toBe('s1')
    expect(typeof first.ts).toBe('string')
    const second = JSON.parse(calls[1].init.body)
    expect(second.payload).toEqual({
      childSessionId: 'c1',
      status: 'completed',
      durationMs: 42,
      summary: 'done',
    })
  })

  it("delivers an agent's @human mention", async () => {
    const hooks = await load()
    await hooks.onHumanMentioned!({
      sessionId: 's1',
      messageId: 'm1',
      from: 'lead',
      text: '@human, ship it?',
    })
    await settle(() => calls.length >= 1)
    const body = JSON.parse(calls[0].init.body)
    expect(body.event).toBe('human_mentioned')
    expect(body.payload).toEqual({ messageId: 'm1', from: 'lead', text: '@human, ship it?' })
  })

  it('signs the body with HMAC-SHA256 when SECRET is set', async () => {
    const hooks = await load({ SECRET: 'topsecret' })
    await hooks.onHitlRequest!({
      sessionId: 's1',
      requestId: 'r1',
      kind: 'confirm',
      toolName: 'bash',
      title: 't',
      payload: {},
    })
    await settle(() => calls.length >= 1)
    expect(calls.length).toBe(1)
    const expected = createHmac('sha256', 'topsecret').update(calls[0].init.body).digest('hex')
    expect(calls[0].init.headers['x-localix-signature']).toBe(expected)
  })

  it('omits the signature header without SECRET', async () => {
    const hooks = await load()
    await hooks.onHitlResolved!({
      sessionId: 's1',
      requestId: 'r1',
      kind: 'ask',
      toolName: 'ask',
      response: { a: 1 },
    })
    await settle(() => calls.length >= 1)
    expect(calls[0].init.headers['x-localix-signature']).toBeUndefined()
  })

  it('EVENTS filter limits deliveries to the selected events', async () => {
    const hooks = await load({ EVENTS: 'assistant_message, subagent_stop' })
    await hooks.onSessionEnd!({ sessionId: 's1' })
    await hooks.onPostToolCall!({
      toolName: 'bash',
      input: {},
      result: { content: 'out' },
      sessionId: 's1',
    })
    await hooks.onAssistantMessage!({ sessionId: 's1', messageId: 'm1', content: 'hi' })
    await settle(() => calls.length >= 1)
    expect(calls.length).toBe(1)
    expect(JSON.parse(calls[0].init.body).event).toBe('assistant_message')
  })

  it('trims oversized text fields', async () => {
    const hooks = await load()
    await hooks.onUserMessage!({ sessionId: 's1', messageId: 'm1', text: 'x'.repeat(10_000) })
    await settle(() => calls.length >= 1)
    const payload = JSON.parse(calls[0].init.body).payload
    expect(payload.text.length).toBeLessThan(5000)
    expect(payload.text.endsWith('…[truncated]')).toBe(true)
  })

  it('delivery failure only logs — never throws into the turn', async () => {
    fetchImpl = async () => {
      throw new Error('connection refused')
    }
    const hooks = await load()
    await hooks.onSessionEnd!({ sessionId: 's1' })
    await settle(() => logs.some((l) => l.includes('delivery failed')))
    expect(logs.some((l) => l.includes('delivery failed'))).toBe(true)
  })

  it('reports a broken endpoint once per session, and forgets the session once it ends', async () => {
    fetchImpl = async () => {
      throw new Error('connection refused')
    }
    const problems: string[] = []
    const reportProblem = ((problem: { sessionId: string }) => {
      problems.push(problem.sessionId)
    }) as PluginContext['reportProblem']
    const hooks = await load({}, { reportProblem })
    await hooks.onUserMessage!({ sessionId: 's1', messageId: 'm1', text: 'a' } as never)
    await hooks.onUserMessage!({ sessionId: 's1', messageId: 'm2', text: 'b' } as never)
    await settle(() => logs.filter((l) => l.includes('delivery failed')).length >= 2)
    expect(problems).toEqual(['s1'])

    await hooks.onSessionEnd!({ sessionId: 's1' })
    await settle(() => logs.filter((l) => l.includes('delivery failed')).length >= 3)
    await new Promise((r) => setTimeout(r, 0))
    // Forgotten after its end: the same id speaks again instead of being remembered forever.
    await hooks.onUserMessage!({ sessionId: 's1', messageId: 'm3', text: 'c' } as never)
    await settle(() => problems.length >= 2)
    expect(problems).toEqual(['s1', 's1'])
  })

  it('the manifest names exactly the events the module delivers', async () => {
    const { ALL_EVENTS } = await import(join(PLUGIN_DIR, 'hooks', 'index.mjs'))
    const manifest = await Bun.file(join(PLUGIN_DIR, 'plugin.json')).json()
    const description = JSON.stringify(manifest)
      .match(/Comma-separated filter: ([a-z_, ]+)\./)?.[1]
      ?.split(', ')
    expect(description).toEqual(ALL_EVENTS)
  })
})

/**
 * Drift guard between the host's lifecycle-hook union and what this notifier declares.
 *
 * The plugin names its hooks in THREE places that nothing forced to agree: the
 * `PluginHooks` interface in the SDK, the `experimental.nativeContributions.hooks`
 * array in plugin.json, and the handlers the module actually returns. A hook added to
 * the union would simply never be delivered by the notifier, and a hook dropped from
 * the manifest would still run — neither shows up as a failure anywhere.
 *
 * `PluginHooks` is a TypeScript interface, so it has no runtime form to reflect over;
 * the union is read from its source, the same structural approach `request-limits.test.ts`
 * uses for a contract that is otherwise invisible at runtime.
 */
describe('webhook-notifier hook coverage', () => {
  /** Hooks the notifier deliberately does not deliver, each with the reason. */
  const EXCLUDED = new Map([
    [
      'onPreToolCall',
      'Blocking hook: it runs BEFORE every tool call and can veto or rewrite it. A ' +
        'notifier on it would put a network round trip in front of every tool call and ' +
        'risk turning a delivery failure into a blocked call. onPostToolCall reports the ' +
        'same call without either hazard.',
    ],
    [
      'onSessionStart',
      'KNOWN GAP, not a design choice: a webhook consumer currently cannot learn that a ' +
        'session began. Wiring it is a behaviour change for existing consumers (it adds a ' +
        'new POST, and EVENTS documents "empty = all"), so it is recorded here rather than ' +
        'added silently.',
    ],
  ])

  const hookUnion = async (): Promise<string[]> => {
    const source = await Bun.file(
      resolve(import.meta.dir, '../../../packages/plugin-sdk/src/backend/hooks.ts'),
    ).text()
    const body = source.slice(source.indexOf('export interface PluginHooks {'))
    return [...body.slice(0, body.indexOf('\n}')).matchAll(/^ {2}(on[A-Za-z]+)\??:/gmu)].map(
      (m) => m[1]!,
    )
  }

  it('implements every lifecycle hook the host defines, minus documented exclusions', async () => {
    const union = await hookUnion()
    // Guard the guard: a parse that silently matched nothing would make this vacuous.
    expect(union.length).toBeGreaterThanOrEqual(9)
    expect(union).toContain('onSessionEnd')

    // The MODULE is the source of truth for what a plugin contributes — the manifest
    // mirror this used to read (`experimental.nativeContributions.hooks`) is gone, and
    // reading it would only ever have proved the mirror matched itself.
    const hooks = await load()
    expect(Object.keys(hooks).sort()).toEqual(union.filter((h) => !EXCLUDED.has(h)).sort())

    // Every exclusion must still be a real hook — a stale entry would quietly widen the guard.
    for (const name of EXCLUDED.keys()) expect(union).toContain(name)
  })
})
