import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'
import type { AssistantMessage } from '@localixai/agent'
import { hostWithMod } from './testing-host'

function tool(name: string, content = `${name} ran`): AgentTool {
  return defineAgentTool({
    name,
    description: `${name} tool`,
    activeVerb: 'Running',
    inputSchema: z.object({}).passthrough(),
    execute: async () => ({ content }),
  }) as AgentTool
}

const SECTIONS = [
  { id: 'identity', text: 'You are Localix.' },
  { id: 'memory', text: 'Remembered things.' },
]
const facts = { sections: SECTIONS, model: 'model-a', tools: [tool('bash')], outputStyle: null }

describe('the system prompt through the mods', () => {
  test('nothing changes and nothing is asked when no mod hears the prompt events', async () => {
    const { scope } = await hostWithMod(() => {})
    expect(await scope.composePrompt(facts)).toBeUndefined()
  })

  test('prompt.section drops or rewrites a section; prompt.compose adds one', async () => {
    const asked: string[] = []
    const { scope } = await hostWithMod((on) => {
      on('prompt.section', { name: 'memory' }, () => ({ text: null }))
      on('prompt.section', ($, e: any, next) => (asked.push(e.name), next(e)))
      on('prompt.compose', async ($, e: any, next) => {
        expect(e).toMatchObject({ model: 'model-a', tools: ['Bash'], surfaces: ['desktop'] })
        const { sections } = (await next(e)) as { sections: unknown[] }
        return { sections: [{ id: 'm:policy', text: 'Be brief.', scope: 'shared' }, ...sections] }
      })
    })
    expect(await scope.composePrompt(facts)).toBe('Be brief.\n\nYou are Localix.')
    // Kept for the conversation: the same prompt is not asked again.
    expect(await scope.composePrompt(facts)).toBe('Be brief.\n\nYou are Localix.')
    expect(asked).toEqual(['identity'])
  })

  test('an answer is kept until the mod invalidates it', async () => {
    let tone = 'calm'
    const { host, scope } = await hostWithMod((on) => {
      on('prompt.section', { name: 'identity' }, () => ({ text: `Be ${tone}.` }))
    })
    expect(await scope.composePrompt(facts)).toBe('Be calm.\n\nRemembered things.')
    tone = 'loud'
    expect(await scope.composePrompt(facts)).toBe('Be calm.\n\nRemembered things.')
    host.invalidate('prompt.section')
    expect(await scope.composePrompt(facts)).toBe('Be loud.\n\nRemembered things.')
  })

  test('attribution.text tells the model what to end a commit with', async () => {
    const { scope } = await hostWithMod((on) => {
      on('attribution.text', { kind: 'commit' }, () => ({ text: 'Signed-off-by: m' }))
    })
    expect(await scope.composePrompt(facts)).toContain(
      '# Git attribution\nEnd every git commit message you write with:\n\nSigned-off-by: m',
    )
  })

  test('prompt.context rewrites the standing context; prompt.attachment drops a reminder', async () => {
    const { scope } = await hostWithMod((on) => {
      on('prompt.context', async ($, e: any, next) =>
        next({ ...e, blocks: [...e.blocks, { name: 'm:note', text: 'Deploys freeze at 5.' }] }),
      )
      on('prompt.attachment', { type: 'turn-limit' }, () => ({ text: null }))
    })
    expect(
      await scope.runtimeContext([
        { key: 'runtime', scope: 'state', text: 'Date: today' },
        { key: 'turn-limit', scope: 'turn', text: 'Ten turns left.' },
        { key: 'hook-context', scope: 'turn', text: 'From a hook.' },
      ]),
    ).toEqual([
      { key: 'runtime', scope: 'state', text: 'Date: today' },
      { key: 'm:note', scope: 'state', text: 'Deploys freeze at 5.' },
      { key: 'hook-context', scope: 'turn', text: 'From a hook.' },
    ])
  })
})

describe('tools through the mods', () => {
  test('tool.describe rewrites a description and moves a tool behind the activator', async () => {
    const { scope } = await hostWithMod((on) => {
      on('tool.describe', { tool: 'Bash' }, ($, e: any) => ({
        description: `${e.description} (careful)`,
        isDeferred: true,
      }))
    })
    const { tools, placed } = await scope.describeTools([tool('bash'), tool('read')], {
      sources: new Map(),
      deferred: () => false,
    })
    expect(tools.map((entry) => entry.description)).toEqual(['bash tool (careful)', 'read tool'])
    expect([...placed]).toEqual([['bash', true]])
  })

  test('tool.check answers the gate, and $.tool.check runs the chain over the gate’s verdict', async () => {
    const checks: unknown[] = []
    const { scope } = await hostWithMod((on) => {
      on('tool.check', { tool: 'Bash' }, ($, e: any) => {
        checks.push(e)
        return { decision: 'deny', reason: 'no shell' }
      })
      on('tool.check', { tool: 'Read' }, ($, e, next) => next(e))
      on('tool.call', { tool: 'Grep' }, async ($: any) => ({
        result: JSON.stringify(await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })),
      }))
    })
    const tools = scope.wrapTools([tool('bash'), tool('read'), tool('search')])
    const port = scope.toolCheck()!
    port.lend(() => ({ decision: 'ask', reason: 'rule' }))
    const call = { toolCallId: 't1', toolName: 'bash', input: { command: 'rm -rf x', timeout: 2 } }
    expect(await port.review!(call, { decision: 'allow' })).toEqual({
      decision: 'deny',
      reason: 'no shell',
    })
    expect(checks[0]).toEqual({
      tool: 'Bash',
      input: { command: 'rm -rf x', timeout: 2000 },
      tool_use_id: 't1',
    })
    expect(
      await port.review!({ ...call, toolName: 'read', input: {} }, { decision: 'ask' }),
    ).toEqual({ decision: 'ask' })
    // The mod's own query passes its own hooks by, as in Claude Code: core is the gate's verdict.
    expect((await tools[2]!.execute('t2', {})).content).toBe(
      JSON.stringify({ decision: 'ask', reason: 'rule' }),
    )
  })

  test('session.append rewrites a tool result before the model reads it', async () => {
    const { scope } = await hostWithMod((on) => {
      on('session.append', { door: 'tool-result' }, ($, e: any, next) =>
        next({
          ...e,
          message: {
            ...e.message,
            content: [{ ...e.message.content[0], content: '[redacted]' }],
          },
        }),
      )
    })
    const [read] = scope.wrapTools([tool('read', 'API_KEY=1')])
    expect((await read!.execute('t1', {})).content).toBe('[redacted]')
  })

  test('agent.offer hides an agent and refuses its dispatch; agent.spawn picks the model', async () => {
    const delegated: unknown[] = []
    const delegate = defineAgentTool({
      name: 'delegate',
      description: 'delegate',
      activeVerb: 'Delegating',
      inputSchema: z.object({}).passthrough(),
      execute: async (_id, input) => (delegated.push(input), { content: 'started' }),
    }) as AgentTool
    const { scope } = await hostWithMod((on) => {
      on('agent.offer', { agent: 'secret' }, () => ({ isOffered: false }))
      on('agent.spawn', ($, e: any, next) =>
        next({ ...e, model: 'small-model', prompt: `${e.prompt} Be quick.` }),
      )
    })
    const listed = await scope.offerAgents([
      { agentId: 'a1', name: 'checker', description: 'Checks' },
      { agentId: 'a2', name: 'secret', description: 'Hidden' },
    ])
    expect(listed.map((agent) => agent.name)).toEqual(['checker'])
    const [wrapped] = scope.wrapTools([delegate])
    expect(await wrapped!.execute('t1', { task: 'x', title: 't', agent: 'secret' })).toMatchObject({
      isError: true,
    })
    await wrapped!.execute('t2', { task: 'Check it.', title: 'Check', agent: 'checker' })
    expect(delegated).toEqual([
      {
        task: 'Check it. Be quick.',
        title: 'Check',
        agent: 'checker',
        wait: false,
        model: 'small-model',
      },
    ])
  })
})

describe('the turn and the conversation through the mods', () => {
  const answer = (text: string): AssistantMessage => ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'model-a',
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 2 },
    timestamp: 0,
  })

  test('turn.step observes the response, or sends the request on another model', async () => {
    const seen: unknown[] = []
    const { scope } = await hostWithMod((on) => {
      on('turn.step', async ($, e: any, next) => {
        const response = await next(e.index === 0 ? e : { ...e, model: 'model-b', effort: 'low' })
        seen.push(response)
        return response
      })
    })
    const step = scope.modelStep('turn-1')!
    const sent: unknown[] = []
    const send = async (override?: unknown) => (sent.push(override), answer('hi'))
    await step({ index: 0, modelId: 'model-a', messageCount: 2 }, send)
    await step({ index: 1, modelId: 'model-a', reasoningEffort: 'high', messageCount: 4 }, send)
    expect(sent).toEqual([{}, { modelId: 'model-b', reasoningEffort: 'low' }])
    expect(seen[0]).toMatchObject({
      turnId: 'turn-1',
      index: 0,
      answer: 'hi',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 2 },
    })
  })

  test('turn.step answered without next sends no request', async () => {
    const { scope } = await hostWithMod((on) => {
      on('turn.step', () => ({
        answer: 'Offline.',
        toolUses: [{ name: 'Bash', input: { command: 'ls' } }],
      }))
    })
    const message = await scope.modelStep('turn-1')!(
      { index: 0, modelId: 'model-a', messageCount: 1 },
      async () => {
        throw new Error('sent')
      },
    )
    expect(message.content[0]).toEqual({ type: 'text', text: 'Offline.' })
    expect(message.content[1]).toMatchObject({
      type: 'tool_call',
      name: 'bash',
      arguments: { command: 'ls' },
    })
  })

  test('session.append rewrites the stored answer, its one text item with it', async () => {
    const { scope } = await hostWithMod((on) => {
      on('session.append', { door: 'response' }, ($, e: any, next) =>
        next({ ...e, message: { ...e.message, content: [{ type: 'text', text: 'Rewritten.' }] } }),
      )
    })
    expect(
      await scope.storeResponse({
        content: 'Original.',
        items: [{ type: 'text', text: 'Original.' }],
      }),
    ).toEqual({ content: 'Rewritten.', items: [{ type: 'text', text: 'Rewritten.' }] })
  })

  test('session.compact skips a checkpoint; $.session.compact asks for one next turn', async () => {
    let skip = true
    const { host, scope, scene } = await hostWithMod((on) => {
      on('session.compact', () => (skip ? { skip: 'not now' } : undefined))
    })
    expect(await scope.compaction('threshold')).toBe('skip')
    skip = false
    expect(await scope.compaction('threshold')).toBe('keep')
    expect(await scope.compaction(undefined)).toBe('keep')
    const api = (await import('./event-calls')).createEventCalls(() => host)
    expect(await api.compact(scene)).toEqual({ messages: [] })
    expect(await scope.compaction(undefined)).toBe('take')
    expect(await scope.compaction(undefined)).toBe('keep')
  })
})
