import { describe, expect, it } from 'bun:test'

import { parseHooksBlock } from './config'
import type { CcHookRegistry } from './contracts'
import type { CcMcpToolCaller } from './mcp-tool-hook'
import { createCcHooksRuntime } from './run'

/** The arguments an mcp_tool hook hands its tool, as a person wrote them in `input`. */
function runtimeWith(event: string, handler: Record<string, unknown>, calls: unknown[]) {
  const registry: CcHookRegistry = parseHooksBlock(
    { [event]: [{ hooks: [{ type: 'mcp_tool', server: 'scan', tool: 'check', ...handler }] }] },
    'project',
    { projectDir: '/p' },
  )
  const callMcpTool: CcMcpToolCaller = async (_name, input) => {
    calls.push(input)
    return { text: '' }
  }
  return createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: '/p',
    enabled: true,
    logger: { warn: () => {}, info: () => {} },
    callMcpTool,
  })
}

describe('mcp_tool hook arguments', () => {
  it('pass `input` with ${path} read from the hook JSON', async () => {
    const calls: unknown[] = []
    const rt = runtimeWith('PreToolUse', { input: { file: '${tool_input.file_path}' } }, calls)
    await rt.runPreToolUse('Write', { file_path: '/a.ts' })
    expect(calls).toEqual([{ file: '/a.ts' }])
  })

  it('send no arguments when the hook has no `input`', async () => {
    const calls: unknown[] = []
    const rt = runtimeWith('PreToolUse', {}, calls)
    await rt.runPreToolUse('Write', { file_path: '/a.ts' })
    expect(calls).toEqual([{}])
  })

  it('substitute inside nested objects, arrays and longer strings; keep other values', async () => {
    const calls: unknown[] = []
    const rt = runtimeWith(
      'PreToolUse',
      {
        input: {
          deep: { list: ['${tool_name}', 3, true, null], note: 'tool ${tool_name} on ${cwd}' },
        },
      },
      calls,
    )
    await rt.runPreToolUse('Write', { file_path: '/a.ts' })
    expect(calls).toEqual([{ deep: { list: ['Write', 3, true, null], note: 'tool Write on /p' } }])
  })

  it('read a path with no value as an empty string, and an object as JSON', async () => {
    const calls: unknown[] = []
    const rt = runtimeWith(
      'PreToolUse',
      { input: { gone: '${tool_input.nope}', all: '${tool_input}' } },
      calls,
    )
    await rt.runPreToolUse('Write', { file_path: '/a.ts' })
    expect(calls).toEqual([{ gone: '', all: '{"file_path":"/a.ts"}' }])
  })
})

describe('mcp_tool hooks on SessionStart', () => {
  it('are skipped at launch, startup and resume, because no MCP server is up yet', async () => {
    for (const source of ['startup', 'resume']) {
      const calls: unknown[] = []
      await runtimeWith('SessionStart', {}, calls).runSessionStart(source)
      expect(calls).toEqual([])
    }
  })

  it('run after a clear or a compaction', async () => {
    for (const source of ['clear', 'compact']) {
      const calls: unknown[] = []
      await runtimeWith('SessionStart', {}, calls).runSessionStart(source)
      expect(calls).toEqual([{}])
    }
  })
})
