import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai'
import { defineAgentTool, type AgentEvent, type AgentTool } from '@localixai/agent/agents'

import { createPiAgentRuntime } from './runtime'
import type { PiModelMiddleware } from './middleware'
import { toPiTool } from './tool-bridge'

/**
 * The bridge's half of pi's mixed scheduler (vendor/pi/UPSTREAM.md): `executionMode`,
 * `executionModeFor`, `parallelScopePaths` and `mutates` must reach the loop so one edit no
 * longer serializes every read of its turn, while two edits of one file still never overlap.
 * Driven end to end through the assembled runtime with a scripted provider.
 */
const log: string[] = []

function probe(
  name: string,
  extra: Partial<AgentTool<{ id: string; path?: string; action?: string }>>,
): AgentTool<{ id: string; path?: string; action?: string }> {
  return defineAgentTool({
    name,
    description: name,
    activeVerb: 'Probing',
    inputSchema: z.object({
      id: z.string(),
      path: z.string().optional(),
      action: z.string().optional(),
    }),
    ...extra,
    async execute(_id, input) {
      log.push(`start:${input.id}`)
      await Bun.sleep(15)
      log.push(`end:${input.id}`)
      return { content: input.id }
    },
  })
}

const pathOf = (input: unknown) => {
  const path = (input as { path?: unknown }).path
  return typeof path === 'string' ? [path] : []
}
const read = probe('read', { executionMode: 'parallel', parallelScopePaths: pathOf })
const edit = probe('edit', { executionMode: 'parallel', mutates: true, parallelScopePaths: pathOf })
const search = probe('search', { executionMode: 'parallel' })
const memory = probe('memory', {
  executionMode: 'sequential',
  mutates: true,
  executionModeFor: (input) =>
    (input as { action?: string }).action === 'get' ? 'parallel' : 'sequential',
})
const tools = [read, edit, search, memory]

async function runBatch(calls: { tool: string; input: Record<string, string> }[]) {
  log.length = 0
  const faux = fauxProvider()
  faux.setResponses([
    fauxAssistantMessage(
      calls.map((call, index) => fauxToolCall(call.tool, call.input, { id: `call-${index}` })),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('done'),
  ])
  const middleware: PiModelMiddleware = {
    wrapStreamSimple: async ({ params }) =>
      faux.provider.streamSimple(faux.getModel(), params.context, params.options),
  }
  const run = createPiAgentRuntime().run({
    sessionId: 'tool-scheduling',
    systemPrompt: 'be brief',
    messages: [{ role: 'user' as const, content: 'go' }],
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    credential: { type: 'api-key' as const, key: 'unused' },
    tools,
    dispatchTools: tools,
    middleware: [middleware],
  } as never)
  const events: AgentEvent[] = []
  for await (const event of run) events.push(event)
  expect((await run.result).terminal).toBe('completed')
  return [...log]
}

const overlapped = (trace: string[], a: string, b: string) =>
  trace.indexOf(`start:${b}`) < trace.indexOf(`end:${a}`) &&
  trace.indexOf(`start:${a}`) < trace.indexOf(`end:${b}`)
const after = (trace: string[], first: string, second: string) =>
  trace.indexOf(`end:${first}`) < trace.indexOf(`start:${second}`)

describe('tool scheduling through the pi bridge', () => {
  test('an edit runs beside reads of other files and edits of other files', async () => {
    const trace = await runBatch([
      { tool: 'edit', input: { id: 'e1', path: '/repo/a.ts' } },
      { tool: 'read', input: { id: 'r1', path: '/repo/b.ts' } },
      { tool: 'edit', input: { id: 'e2', path: '/repo/c.ts' } },
    ])
    expect(overlapped(trace, 'e1', 'r1')).toBe(true)
    expect(overlapped(trace, 'e1', 'e2')).toBe(true)
  })

  test('edits of one file, and a read of a file being edited, keep source order', async () => {
    const trace = await runBatch([
      { tool: 'edit', input: { id: 'e1', path: '/repo/a.ts' } },
      { tool: 'edit', input: { id: 'e2', path: '/repo/a.ts' } },
      { tool: 'read', input: { id: 'r1', path: '/repo/a.ts' } },
      { tool: 'search', input: { id: 's1' } },
    ])
    expect(after(trace, 'e1', 'e2')).toBe(true)
    expect(after(trace, 'e2', 'r1')).toBe(true)
    // A search names no path, so it cannot overlap an edit.
    expect(after(trace, 'e2', 's1')).toBe(true)
  })

  test('per-call modes: a memory read overlaps reads, a memory write is a barrier', async () => {
    const trace = await runBatch([
      { tool: 'memory', input: { id: 'get', action: 'get' } },
      { tool: 'search', input: { id: 's1' } },
      { tool: 'memory', input: { id: 'set', action: 'set' } },
      { tool: 'search', input: { id: 's2' } },
    ])
    expect(overlapped(trace, 'get', 's1')).toBe(true)
    expect(after(trace, 's1', 'set')).toBe(true)
    expect(after(trace, 'set', 's2')).toBe(true)
  })

  test('the bridge passes the static mode through and derives the scope from mutates', () => {
    const piEdit = toPiTool(edit as AgentTool, undefined, new Map())
    expect(piEdit.executionMode).toBe('parallel')
    expect(piEdit.executionScope?.({ id: 'x', path: '/a' })).toEqual({
      paths: ['/a'],
      writes: true,
    })
    const piRead = toPiTool(read as AgentTool, undefined, new Map())
    expect(piRead.executionScope?.({ id: 'x', path: '/a' })).toEqual({
      paths: ['/a'],
      writes: false,
    })
    const piMemory = toPiTool(memory as AgentTool, undefined, new Map())
    expect(piMemory.executionModeFor?.({ id: 'x', action: 'get' })).toBe('parallel')
    expect(piMemory.executionScope).toBeUndefined()
  })
})
