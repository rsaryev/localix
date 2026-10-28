import { describe, expect, test } from 'bun:test'
import { describeFixedContext, type AgentTool } from '@localixai/agent/agents'
import { z } from 'zod'

import { captureForkSeed, forkSeedSchema, forkToolSurface, NESTED_FORK_REFUSAL } from './fork-seed'
import { resolveRunProfile } from './run-shape'
import { richRegistry } from './prompt/testing/prompt-render'
import { TOOL } from './tool-names'

/**
 * A fork is sent the parent's system prompt and tools, byte for byte: they come first in every
 * provider's cache prefix, so a single differing tool description would turn the whole cache read
 * into a write. What a child is OFFERED depends on its run shape (a chat carries MCP and the
 * conversation's tools, a delegated child a closed set), so the fork is given the parent's
 * declarations and executes them with its own tools.
 */
const parentTools = () => richRegistry(resolveRunProfile({ sessionKind: 'chat' })).tools
const childTools = () => richRegistry(resolveRunProfile({ sessionKind: 'subagent' })).tools
const SYSTEM = 'You are the parent.\n\nA long, session-invariant prompt.'

const seedOf = () =>
  captureForkSeed({
    systemPrompt: SYSTEM,
    tools: parentTools(),
    cacheSessionId: 'parent',
    toolNames: [],
    profile: resolveRunProfile({ sessionKind: 'chat' }),
  })

describe('the tools a fork is shown', () => {
  test('a child run assembled on its own is NOT the parent’s block (positive control)', () => {
    expect(describeFixedContext(SYSTEM, childTools()).toolSchemaHash).not.toBe(
      describeFixedContext(SYSTEM, parentTools()).toolSchemaHash,
    )
  })

  test('are the parent’s, in its order, whatever the child would have been given', () => {
    const own = childTools()
    const { tools } = forkToolSurface(seedOf(), { tools: own, dispatchTools: own })
    const parent = parentTools()
    expect(tools.map((tool) => tool.name)).toEqual(parent.map((tool) => tool.name))
    expect(tools.map((tool) => tool.modelName)).toEqual(parent.map((tool) => tool.modelName))
    const seen = describeFixedContext(SYSTEM, tools)
    const sent = describeFixedContext(SYSTEM, parent)
    expect(seen.toolSchemaHash).toBe(sent.toolSchemaHash)
    expect(seen.systemPromptHash).toBe(sent.systemPromptHash)
  })

  test('survive storage: the seed is plain JSON and parses back to the same block', () => {
    const stored = forkSeedSchema.parse(JSON.parse(JSON.stringify(seedOf())))
    const own = childTools()
    const { tools } = forkToolSurface(stored, { tools: own, dispatchTools: own })
    expect(describeFixedContext(SYSTEM, tools).toolSchemaHash).toBe(
      describeFixedContext(SYSTEM, parentTools()).toolSchemaHash,
    )
  })
})

describe('what a fork can run', () => {
  const noop = z.object({}).passthrough()
  const tool = (name: string, text: string): AgentTool =>
    ({
      name,
      description: `${name} of the child`,
      inputSchema: noop,
      activeVerb: 'Running',
      execute: async () => ({ content: text }),
    }) as AgentTool

  test('a tool it has runs its own implementation, under the parent’s declaration', async () => {
    const seed = captureForkSeed({
      systemPrompt: SYSTEM,
      tools: [{ ...tool('read', 'parent'), description: 'the parent’s words' } as AgentTool],
      cacheSessionId: 'parent',
      toolNames: [],
      profile: resolveRunProfile({ sessionKind: 'chat' }),
    })
    const { tools, dispatchTools } = forkToolSurface(seed, {
      tools: [tool('read', 'child')],
      dispatchTools: [tool('read', 'child')],
    })
    expect(tools[0]!.description).toBe('the parent’s words')
    expect((await dispatchTools[0]!.execute('c', {})).content).toBe('child')
  })

  test('a tool it was shown but cannot run answers with an error, and is still listed', async () => {
    const seed = captureForkSeed({
      systemPrompt: SYSTEM,
      tools: [tool('read', 'p'), tool(TOOL.Agent, 'p'), tool('mcp__x__y', 'p')],
      cacheSessionId: 'parent',
      toolNames: [],
      profile: resolveRunProfile({ sessionKind: 'chat' }),
    })
    const { tools, dispatchTools } = forkToolSurface(seed, {
      tools: [tool('read', 'child')],
      dispatchTools: [tool('read', 'child')],
    })
    expect(tools.map((t) => t.name)).toEqual(['read', TOOL.Agent, 'mcp__x__y'])
    const run = async (name: string) => dispatchTools.find((t) => t.name === name)!.execute('c', {})
    expect(await run(TOOL.Agent)).toEqual({ content: NESTED_FORK_REFUSAL, isError: true })
    const missing = await run('mcp__x__y')
    expect(missing.isError).toBe(true)
    expect(missing.content).toContain('mcp__x__y')
    // Refusing is not an action: it is never held for a confirmation.
    expect(dispatchTools[1]!.classify?.({})).toEqual({ effect: 'read' })
  })

  test('tools the parent was not shown stay dispatchable but are not offered', () => {
    const seed = captureForkSeed({
      systemPrompt: SYSTEM,
      tools: [tool('read', 'p')],
      cacheSessionId: 'parent',
      toolNames: [],
      profile: resolveRunProfile({ sessionKind: 'chat' }),
    })
    const { tools, dispatchTools } = forkToolSurface(seed, {
      tools: [tool('read', 'c'), tool('write', 'c')],
      dispatchTools: [tool('read', 'c'), tool('write', 'c'), tool('deferred', 'c')],
    })
    expect(tools.map((t) => t.name)).toEqual(['read'])
    expect(dispatchTools.map((t) => t.name).sort()).toEqual(['deferred', 'read', 'write'])
  })
})
