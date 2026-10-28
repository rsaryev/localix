import { describe, expect, it } from 'bun:test'

import { parseHooksBlock } from './config'
import { createCcHooksRuntime } from './run'

/** A PreToolUse hook whose tool answers with `answer` (hooks.md: `permissionDecision: "defer"`). */
function runtimeAnswering(answer: Record<string, unknown>, warnings: string[]) {
  return createCcHooksRuntime({
    registry: parseHooksBlock(
      { PreToolUse: [{ hooks: [{ type: 'mcp_tool', server: 's', tool: 't' }] }] },
      'project',
      { projectDir: '/p' },
    ),
    sessionId: 's1',
    projectDir: '/p',
    enabled: true,
    logger: { warn: (m: string) => warnings.push(m), info: () => {} },
    callMcpTool: async () => ({ text: JSON.stringify({ hookSpecificOutput: answer }) }),
  })
}

describe('permissionDecision "defer"', () => {
  it('is warned about and ignored, as in an interactive Claude Code session', async () => {
    const warnings: string[] = []
    const rt = runtimeAnswering(
      { permissionDecision: 'defer', updatedInput: { command: 'rewritten' } },
      warnings,
    )
    const res = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(res).toMatchObject({ decision: 'proceed', didRewrite: false })
    expect(warnings.join('\n')).toContain('defer')
  })

  it('does not stop a later hook from denying', async () => {
    const rt = createCcHooksRuntime({
      registry: parseHooksBlock(
        {
          PreToolUse: [
            {
              hooks: [
                { type: 'mcp_tool', server: 's', tool: 'defer' },
                { type: 'mcp_tool', server: 's', tool: 'deny' },
              ],
            },
          ],
        },
        'project',
        { projectDir: '/p' },
      ),
      sessionId: 's1',
      projectDir: '/p',
      enabled: true,
      logger: { warn: () => {}, info: () => {} },
      callMcpTool: async (name) => ({
        text: JSON.stringify({
          hookSpecificOutput: { permissionDecision: name.endsWith('defer') ? 'defer' : 'deny' },
        }),
      }),
    })
    expect((await rt.runPreToolUse('bash', {})).decision).toBe('deny')
  })
})
