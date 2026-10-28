import { describe, expect, it } from 'bun:test'
import { retrieveStoredOutput } from './retrieve-output'

// Minimal fake repo: the tool only reads message.payload.items.
// deno-lint-ignore no-explicit-any
const repoWith = (items: unknown[]): any => ({
  findActiveBranchToolCallMessage: async () => ({ payload: { items } }),
})
const item = (toolCallId: string, resultText: string) => ({
  id: toolCallId,
  toolCallId,
  name: 'Bash',
  type: 'command',
  status: 'completed',
  resultText,
})

const retrieveHarness = (
  repo: Parameters<typeof retrieveStoredOutput>[0],
  userId: string,
  sessionId: string,
  artifactStore?: Parameters<typeof retrieveStoredOutput>[4],
) => ({
  execute: (_toolCallId: string, input: { tool_call_id: string }) =>
    retrieveStoredOutput(repo, userId, sessionId, input.tool_call_id, artifactStore),
})

describe('ToolOutput action="get"', () => {
  it('recovers a pre-message durable artifact, including a successful mutation input', async () => {
    let historyRead = false
    const tool = retrieveHarness(
      {
        findActiveBranchToolCallMessage: async () => {
          historyRead = true
          return null
        },
      },
      'u1',
      's1',
      {
        getToolOutputArtifact: async () => ({
          toolCallId: 'w1',
          toolName: 'Write',
          text: 'Wrote 25 bytes to /repo/a.ts',
          input: { path: '/repo/a.ts', content: 'export const answer = 42\n' },
          isError: false,
        }),
      },
    )
    const r = await tool.execute('x', { tool_call_id: 'w1' })
    expect(historyRead).toBe(false)
    expect(r.content).toContain('original `content` argument of Write')
    expect(r.content).toContain('export const answer = 42')
    expect(r.content).toContain('Wrote 25 bytes')
  })

  it('returns the full original resultText for a matching tool_call_id', async () => {
    const tool = retrieveHarness(repoWith([item('c1', 'FULL ORIGINAL OUTPUT 12345')]), 'u1', 's1')
    const r = await tool.execute('x', { tool_call_id: 'c1' })
    expect(r.content).toBe('FULL ORIGINAL OUTPUT 12345')
    expect(r.isError).toBeFalsy()
  })

  it("serves a mutating call's elided INPUT, not its one-line result summary", async () => {
    // The elision pointer on a `write` sits on its `content` arg; the stored `resultText`
    // is only "Wrote N bytes to …". Serving that would make the pointer's promise false.
    const write = {
      id: 'w1',
      toolCallId: 'w1',
      name: 'Write',
      type: 'tool_call',
      status: 'completed',
      input: { path: '/repo/a.ts', content: 'export const answer = 42\n' },
      resultText: 'Wrote 25 bytes to /repo/a.ts',
    }
    const tool = retrieveHarness(repoWith([write]), 'u1', 's1')
    const r = await tool.execute('x', { tool_call_id: 'w1' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('export const answer = 42')
    expect(r.content).toContain('original `content` argument of Write')
    expect(r.content).toContain('Wrote 25 bytes')
  })

  it('errors when the tool_call_id is not in this session', async () => {
    const tool = retrieveHarness(repoWith([item('c1', 'x')]), 'u1', 's1')
    const r = await tool.execute('x', { tool_call_id: 'missing' })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('missing')
  })

  it('clips a very large original so retrieval cannot re-balloon context', async () => {
    const big = 'a'.repeat(150_000)
    const tool = retrieveHarness(repoWith([item('c1', big)]), 'u1', 's1')
    const r = await tool.execute('x', { tool_call_id: 'c1' })
    expect(r.content.length).toBeLessThan(big.length)
    expect(r.content).toContain('clipped at')
  })

  it('errors gracefully if history cannot be loaded', async () => {
    // deno-lint-ignore no-explicit-any
    const repo: any = {
      findActiveBranchToolCallMessage: async () => {
        throw new Error('db down')
      },
    }
    const tool = retrieveHarness(repo, 'u1', 's1')
    const r = await tool.execute('x', { tool_call_id: 'c1' })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('db down')
  })
})
