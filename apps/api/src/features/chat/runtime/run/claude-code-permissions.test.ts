import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { AgentTool } from '@localixai/agent/agents'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { createPermissionGate, type PermissionRule } from '../../../agent-core/permission-engine'
import { claudeCodeRulePort, loadClaudeCodePermissions } from './claude-code-permissions'

/**
 * A person's Claude Code `permissions` reach a Localix run's gate: a deny in any settings file
 * refuses, an ask raises a card, an allow answers the agent's catch-all question — and a mode
 * that stops asking stops asking about these too, as `bypassPermissions` does.
 */
const scratch = tempDirPerTest('cc-run-permissions-')

const tool = (name: string, extra: Partial<AgentTool> = {}): AgentTool =>
  ({ name, classify: () => ({ effect: 'external' }), ...extra }) as unknown as AgentTool

async function gateFor(
  tree: Record<string, string>,
  rules: PermissionRule[],
  mode: 'default' | 'bypass' = 'default',
) {
  const root = scratch()
  writeTree(root, tree)
  const cwd = join(root, 'project')
  const loaded = await loadClaudeCodePermissions({
    homeDir: join(root, 'home'),
    cwd,
    env: {},
    managed: { dir: join(root, 'managed') },
  })
  const asked: string[] = []
  const tools = [tool('bash'), tool('read', { classify: () => ({ effect: 'read' }) })]
  const gate = createPermissionGate({
    rules,
    toolsByName: new Map(tools.map((t) => [t.name, t])),
    root: cwd,
    outerRules: claudeCodeRulePort(loaded, { homeDir: join(root, 'home'), mode }),
    requestConfirm: async (args) => {
      asked.push(args.toolName)
      return true
    },
  })
  const run = (toolName: string, input: unknown) => gate({ toolCallId: 'c', toolName, input })
  return { run, asked, cwd }
}

const ALLOW_ALL: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'allow' }]
const ASK_ALL: PermissionRule[] = [{ permission: '*', pattern: '*', action: 'ask' }]

describe("Claude Code's permission rules in a Localix run", () => {
  test("a deny in the project's settings refuses even what the agent allows", async () => {
    const { run } = await gateFor(
      {
        'project/.claude/settings.json': JSON.stringify({
          permissions: { deny: ['Bash(rm *)', 'Read(./.env)'] },
        }),
      },
      ALLOW_ALL,
    )
    expect((await run('bash', { command: 'rm -rf build' }))?.block).toBe(true)
    expect((await run('read', { path: '.env' }))?.block).toBe(true)
    expect((await run('bash', { command: 'ls' }))?.block).toBeUndefined()
  })

  test('an ask raises a card; a mode that stops asking lets it through', async () => {
    const tree = {
      'home/.claude/settings.json': JSON.stringify({
        permissions: { ask: ['Bash(git push *)'] },
      }),
    }
    const asking = await gateFor(tree, ALLOW_ALL)
    expect((await asking.run('bash', { command: 'git push origin main' }))?.block).toBeUndefined()
    expect(asking.asked).toEqual(['bash'])
    const bypass = await gateFor(tree, ALLOW_ALL, 'bypass')
    await bypass.run('bash', { command: 'git push origin main' })
    expect(bypass.asked).toEqual([])
  })

  test("an allow answers the agent's catch-all question, never its denial", async () => {
    const { run, asked } = await gateFor(
      {
        'home/.claude/settings.json': JSON.stringify({
          permissions: { allow: ['Bash(npm test *)', 'Bash(rm *)'] },
        }),
      },
      [...ASK_ALL, { permission: 'bash', pattern: 'rm *', action: 'deny' }],
    )
    expect((await run('bash', { command: 'npm test' }))?.block).toBeUndefined()
    expect(asked).toEqual([])
    expect((await run('bash', { command: 'rm x' }))?.block).toBe(true)
    await run('bash', { command: 'make' })
    expect(asked).toEqual(['bash'])
  })
})
