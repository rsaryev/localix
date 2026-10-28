import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'

import { createEngine } from './engine'

/**
 * What OpenAI is sent across the steps of one run, read off the HTTP requests of the real engine.
 * OpenAI's automatic prefix cache needs two things from a run: every request an exact extension of
 * the one before it, and a routing identity that keeps the requests on the machine that holds the
 * prefix: the cache key in the body and the session headers (`session_id`, `x-client-request-id`)
 * the engine this one replaced sent with it.
 */

interface Sent {
  headers: Headers
  body: { input: unknown[]; tools: unknown[]; prompt_cache_key?: string }
}

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

const sse = (events: object[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })

/** A model that calls `echo` twice, then answers: three requests per run. */
function stubOpenAI(sent: Sent[]) {
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    sent.push({
      headers: new Headers(init.headers),
      body: JSON.parse(init.body as string),
    })
    const step = sent.length
    const items =
      step < 3
        ? [
            { type: 'reasoning', id: `rs_${step}`, encrypted_content: `enc${step}`, summary: [] },
            {
              type: 'function_call',
              id: `fc_${step}`,
              call_id: `call_${step}`,
              name: 'echo',
              arguments: '{"v":"a"}',
              status: 'completed',
            },
          ]
        : [
            {
              type: 'message',
              id: 'msg_1',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'done', annotations: [] }],
            },
          ]
    return sse([
      { type: 'response.created', response: { id: `r${step}`, created_at: 1, model: 'm' } },
      ...items.flatMap((item, index) => [
        { type: 'response.output_item.added', output_index: index, item },
        { type: 'response.output_item.done', output_index: index, item },
      ]),
      {
        type: 'response.completed',
        response: {
          id: `r${step}`,
          incomplete_details: null,
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      },
    ])
  }) as unknown as typeof fetch
}

async function runOnce(sessionId: string, promptCacheKey?: string) {
  const echo = defineAgentTool({
    name: 'echo',
    description: 'Echo.',
    inputSchema: z.object({ v: z.string() }),
    activeVerb: 'Echoing',
    async execute() {
      return { content: 'ok' }
    },
  })
  const run = createEngine().runtime.run({
    sessionId,
    ...(promptCacheKey ? { promptCacheKey } : {}),
    model: { providerId: 'openai', modelId: 'gpt-6.1-sol' },
    credential: { type: 'api-key', key: 'k' },
    systemPrompt: 'SYS',
    messages: [{ role: 'user', content: 'hi', timestamp: 0 }],
    tools: [echo as never],
    reasoningEffort: 'high',
  })
  for await (const _event of run) void _event
  return run.result
}

describe('the requests of one run to OpenAI', () => {
  test('each extends the one before it byte for byte, with the same tools', async () => {
    const sent: Sent[] = []
    stubOpenAI(sent)
    await runOnce('LOCALIX-1')
    expect(sent).toHaveLength(3)
    for (let i = 1; i < sent.length; i++) {
      const before = sent[i - 1]!.body
      const after = sent[i]!.body
      expect(JSON.stringify(after.input.slice(0, before.input.length))).toBe(
        JSON.stringify(before.input),
      )
      expect(JSON.stringify(after.tools)).toBe(JSON.stringify(before.tools))
    }
  })

  test('all carry the session as the cache key and as the routing headers', async () => {
    const sent: Sent[] = []
    stubOpenAI(sent)
    await runOnce('LOCALIX-1')
    for (const { headers, body } of sent) {
      expect(body.prompt_cache_key).toBe('LOCALIX-1')
      expect(headers.get('session_id')).toBe('LOCALIX-1')
      expect(headers.get('x-client-request-id')).toBe('LOCALIX-1')
    }
  })

  test('a session id longer than the key OpenAI accepts is cut, in the key and the headers alike', async () => {
    const sent: Sent[] = []
    stubOpenAI(sent)
    const long = `s${'x'.repeat(100)}`
    await runOnce(long)
    const key = sent[0]!.body.prompt_cache_key!
    expect(key).toHaveLength(64)
    expect(long.startsWith(key)).toBe(true)
    expect(sent[0]!.headers.get('session_id')).toBe(key)
    expect(sent[0]!.headers.get('x-client-request-id')).toBe(key)
  })

  test('a key the host names replaces the session id, in the key and the headers alike', async () => {
    const sent: Sent[] = []
    for (const id of ['LOCALIX-1', 'LOCALIX-2']) {
      sent.length = 0
      stubOpenAI(sent)
      await runOnce(id, 'lx-shared')
      expect(sent).toHaveLength(3)
      assertKeyed(sent)
    }
  })
})

function assertKeyed(sent: Sent[]) {
  for (const { headers, body } of sent) {
    expect(body.prompt_cache_key).toBe('lx-shared')
    expect(headers.get('session_id')).toBe('lx-shared')
    expect(headers.get('x-client-request-id')).toBe('lx-shared')
  }
}
