import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  defineAgentTool,
  type AgentTool,
  type AgentToolExecutionContext,
} from '@localixai/agent/agents'
import { createScriptSandbox } from '@localixai/engine-scripts'

import { createCodemodeTool } from './codemode'

/**
 * `codemode` on the engine's real sandbox: it declares the run's `read`/`bash`/`edit`/`write` and
 * nothing else, every call goes through `context.callTool`, and only the script's output returns.
 */
const scripts = createScriptSandbox()

const tool = (name: string): AgentTool =>
  defineAgentTool({
    name,
    description: `The ${name} tool.`,
    activeVerb: name,
    inputSchema: z.object({ path: z.string() }),
    execute: async () => ({ content: 'unused' }),
  }) as AgentTool

const signal = new AbortController().signal

describe('codemode', () => {
  test('declares only the script tools this run has', () => {
    const codemode = createCodemodeTool(scripts, [tool('read'), tool('bash'), tool('memory')])
    expect(codemode.description).toContain('Run JavaScript that calls other tools')
    expect(codemode.description).toContain('The read tool.')
    expect(codemode.description).toContain('The bash tool.')
    expect(codemode.description).not.toContain('memory')
    expect(codemode.description).not.toContain('The edit tool.')
  })

  test('calls tools through the run, and returns only the output and the value', async () => {
    const seen: [string, unknown][] = []
    const context: AgentToolExecutionContext = {
      callTool: async (name, input) => {
        seen.push([name, input])
        return (input as { path: string }).path === 'missing'
          ? { result: { content: 'No such file: missing' }, isError: true }
          : {
              result: { content: `contents of ${(input as { path: string }).path}` },
              isError: false,
            }
      },
    }
    const codemode = createCodemodeTool(scripts, [tool('read')])
    const result = await codemode.execute(
      'call-1',
      {
        code: `
          const [a, b] = await Promise.allSettled([
            tools.read({ path: 'a.ts' }),
            tools.read({ path: 'missing' }),
          ])
          text(a.value.length)
          return b.reason.message
        `,
      },
      signal,
      undefined,
      context,
    )
    expect(seen).toEqual([
      ['read', { path: 'a.ts' }],
      ['read', { path: 'missing' }],
    ])
    expect(result.content).toBe(`${'contents of a.ts'.length}\nNo such file: missing`)
    expect(result.isError).toBeUndefined()
    // The card's record: each call's input, outcome and time — never its result.
    expect(result.details).toEqual({
      calls: [
        { name: 'read', args: { path: 'a.ts' }, status: 'ok', durationMs: expect.any(Number) },
        {
          name: 'read',
          args: { path: 'missing' },
          status: 'error',
          durationMs: expect.any(Number),
          error: 'No such file: missing',
        },
      ],
      complete: true,
    })
  })

  test('a failing script is an error result that keeps its output', async () => {
    const codemode = createCodemodeTool(scripts, [])
    const result = await codemode.execute(
      'call-2',
      { code: `text('before'); throw new Error('nope')` },
      signal,
      undefined,
      { callTool: async () => ({ result: { content: '' }, isError: false }) },
    )
    expect(result.isError).toBe(true)
    expect(result.content).toStartWith('before\nScript failed: ')
    expect(result.content).toContain('nope')
  })

  test('without nested calls the tool says so instead of running', async () => {
    const result = await createCodemodeTool(scripts, []).execute(
      'call-3',
      { code: 'return 1' },
      signal,
      undefined,
      {},
    )
    expect(result).toMatchObject({ isError: true })
  })
})
