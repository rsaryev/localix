import { expect, test } from 'bun:test'
import { z } from 'zod'
import type { AgentTool } from '@localixai/agent/agents'
import { createHumanInLoopController } from '@localixai/agent/agents'

import { piContentOf, toPiTool } from './tool-bridge'

test('an image-only result keeps its text label ahead of the picture', () => {
  // A screenshot returned `content: "Screenshot (4×4)."` beside one image part, and the part list
  // replaced the text: the model saw an unlabeled picture and the stored text became `[image]`.
  const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA' }
  expect(piContentOf({ content: 'Screenshot (4×4).', contentParts: [image] })).toEqual([
    { type: 'text', text: 'Screenshot (4×4).' },
    { type: 'image', mimeType: 'image/png', data: 'AAAA' },
  ])
  // Parts that carry their own text (an MCP result) are sent as they are, never doubled.
  const mcp = [{ type: 'text' as const, text: 'hello' }, image]
  expect(piContentOf({ content: 'hello[image]', contentParts: mcp })).toHaveLength(2)
  expect(piContentOf({ content: 'plain' })).toEqual([{ type: 'text', text: 'plain' }])
})

test('the same tool implementation receives isolated contexts and result stores per run', async () => {
  const contexts = [
    { sanitizeResult: () => ({ content: 'run A' }) },
    { sanitizeResult: () => ({ content: 'run B' }) },
  ]
  const received: unknown[] = []
  const tool: AgentTool = {
    name: 'probe',
    activeVerb: 'Probing',
    description: 'test',
    inputSchema: z.object({}),
    async execute(_id, _input, _signal, _update, context) {
      received.push(context)
      await Promise.resolve()
      return { content: 'raw' }
    },
  }
  const stores = [new Map(), new Map()]
  const results = await Promise.all(
    contexts.map((context, index) =>
      toPiTool(tool, context, stores[index]!).execute(
        'same-call-id',
        {},
        new AbortController().signal,
      ),
    ),
  )
  expect(received[0]).toBe(contexts[0])
  expect(received[1]).toBe(contexts[1])
  for (const [index, text] of ['run A', 'run B'].entries()) {
    expect(results[index]?.content).toEqual([{ type: 'text', text }])
    expect(stores[index]?.get('same-call-id')).toEqual({ content: text })
  }
})

test('HITL inherits run cancellation even when a tool supplies its own live signal', async () => {
  for (const explicitSignal of [undefined, new AbortController().signal]) {
    const controller = createHumanInLoopController()
    const run = new AbortController()
    const tool: AgentTool = {
      name: 'ask',
      activeVerb: 'Asking',
      description: 'test',
      inputSchema: z.object({}),
      async execute(id, _input, _signal, _update, context) {
        await context!.humanInLoop!.request(
          { id, kind: 'ask', payload: {}, createdAt: 1 },
          explicitSignal,
        )
        return { content: 'unexpected answer' }
      },
    }
    const completed = new Map()
    const execution = toPiTool(tool, { humanInLoop: controller }, completed).execute(
      'request',
      {},
      run.signal,
    )
    const settled = execution.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(controller.getPending('request')).toBeDefined()
    run.abort()
    expect(await settled).toBeInstanceOf(Error)
    expect(controller.getPending('request')).toBeUndefined()
    expect(completed.size).toBe(0)
  }
})

// Pi validates arguments against the JSON schema BEFORE execute, and nothing on the dispatch
// path parses the zod schema, so a `z.preprocess` rewrite never ran there: browser's
// lifts were live only in unit tests while models were refused in production.
test('a tool’s argument preparation is handed to pi, which runs it before validation', () => {
  const tool: AgentTool = {
    name: 'probe',
    activeVerb: 'Probing',
    description: 'test',
    inputSchema: z.object({ a: z.number() }),
    prepareArguments: (raw: unknown) => ({ ...(raw as object), lifted: true }),
    execute: async () => ({ content: '' }),
  }
  expect(toPiTool(tool, undefined, new Map()).prepareArguments?.({ a: 1 })).toEqual({
    a: 1,
    lifted: true,
  })
})

// A GPT-family model now and then wraps nothing in an empty `parameters: {}` beside the real
// arguments; the strict schema then refuses the whole call ("parameters: schema is false").
// Seen on `agents` and twice on `browser` — never meaningful.
test('an empty `parameters` wrapper the schema does not declare is dropped before validation', () => {
  const tool: AgentTool = {
    name: 'probe',
    activeVerb: 'Probing',
    description: 'test',
    inputSchema: z.object({ a: z.number() }),
    execute: async () => ({ content: '' }),
  }
  const prepare = toPiTool(tool, undefined, new Map()).prepareArguments!
  expect(prepare({ a: 1, parameters: {} })).toEqual({ a: 1 })
  // Anything else stays for the schema to judge: a non-empty wrapper, or a declared field.
  expect(prepare({ a: 1, parameters: { b: 2 } })).toEqual({ a: 1, parameters: { b: 2 } })
  const declared = { ...tool, inputSchema: z.object({ parameters: z.object({}) }) }
  expect(toPiTool(declared, undefined, new Map()).prepareArguments!({ parameters: {} })).toEqual({
    parameters: {},
  })
})

// LOCALIX-164: the whole call inside the wrapper, `{action, parameters: {preview_id, steps}}`.
test('a `parameters` wrapper holding only declared fields is lifted into the call', () => {
  const tool: AgentTool = {
    name: 'probe',
    activeVerb: 'Probing',
    description: 'test',
    inputSchema: z.object({ a: z.number(), b: z.number().optional() }),
    execute: async () => ({ content: '' }),
  }
  const prepare = toPiTool(tool, undefined, new Map()).prepareArguments!
  expect(prepare({ parameters: { a: 1, b: 2 } })).toEqual({ a: 1, b: 2 })
  expect(prepare({ a: 1, parameters: { a: 1, b: 2 } })).toEqual({ a: 1, b: 2 })
  expect(prepare({ a: 1, parameters: null })).toEqual({ a: 1 })
  // A conflicting value has two readings: the schema judges it.
  expect(prepare({ a: 1, parameters: { a: 3 } })).toEqual({ a: 1, parameters: { a: 3 } })
})
