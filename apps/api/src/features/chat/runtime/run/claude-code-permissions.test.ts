import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import type { AgentTool } from '@localixai/agent/agents'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { PermissionRule } from '../../../agent-core/permission-engine'
import { claudeCodeGateOptions, loadClaudeCodePermissions } from './claude-code-permissions'
import { createPermissionGate } from '../../../agent-core/permission-gate'

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
  const tools = [tool('Bash'), tool('Read', { classify: () => ({ effect: 'read' }) })]
  const gate = createPermissionGate({
    rules,
    toolsByName: new Map(tools.map((t) => [t.name, t])),
    root: cwd,
    ...claudeCodeGateOptions(loaded, { homeDir: join(root, 'home'), mode }),
    requestConfirm: async (args) => {
      asked.push(args.toolName)
      return { approved: true }
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
    expect((await run('Bash', { command: 'rm -rf build' }))?.block).toBe(true)
    expect((await run('Read', { path: '.env' }))?.block).toBe(true)
    expect((await run('Bash', { command: 'ls' }))?.block).toBeUndefined()
  })

  test('an ask raises a card; a mode that stops asking lets it through', async () => {
    const tree = {
      'home/.claude/settings.json': JSON.stringify({
        permissions: { ask: ['Bash(git push *)'] },
      }),
    }
    const asking = await gateFor(tree, ALLOW_ALL)
    expect((await asking.run('Bash', { command: 'git push origin main' }))?.block).toBeUndefined()
    expect(asking.asked).toEqual(['Bash'])
    const bypass = await gateFor(tree, ALLOW_ALL, 'bypass')
    await bypass.run('Bash', { command: 'git push origin main' })
    expect(bypass.asked).toEqual([])
  })

  test("an allow answers the agent's catch-all question, never its denial", async () => {
    const { run, asked } = await gateFor(
      {
        'home/.claude/settings.json': JSON.stringify({
          permissions: { allow: ['Bash(npm test *)', 'Bash(rm *)'] },
        }),
      },
      [...ASK_ALL, { permission: 'Bash', pattern: 'rm *', action: 'deny' }],
    )
    expect((await run('Bash', { command: 'npm test' }))?.block).toBeUndefined()
    expect(asked).toEqual([])
    expect((await run('Bash', { command: 'rm x' }))?.block).toBe(true)
    await run('Bash', { command: 'make' })
    expect(asked).toEqual(['Bash'])
  })

  test('Read and Edit rules guard the files a shell line names', async () => {
    const { run } = await gateFor(
      {
        'project/.claude/settings.json': JSON.stringify({
          permissions: { deny: ['Read(./.env)', 'Edit(src/**)'] },
        }),
      },
      ALLOW_ALL,
    )
    expect((await run('Bash', { command: 'cat .env' }))?.block).toBe(true)
    expect((await run('Bash', { command: 'echo hi > src/app.ts' }))?.block).toBe(true)
    expect((await run('Bash', { command: 'sed -i s/a/b/ src/app.ts' }))?.block).toBe(true)
    expect((await run('Bash', { command: 'cat src/app.ts' }))?.block).toBeUndefined()
  })

  test('additionalDirectories count as inside the workspace', async () => {
    const outside = [{ permission: '*', pattern: 'outside-workspace', action: 'ask' } as const]
    const { run, asked, cwd } = await gateFor(
      {
        'home/.claude/settings.json': JSON.stringify({
          permissions: { additionalDirectories: ['../shared'] },
        }),
        'shared/notes.md': 'notes',
        'elsewhere/x.md': 'x',
      },
      [...ALLOW_ALL, ...outside],
    )
    await run('Read', { path: join(cwd, '../shared/notes.md') })
    expect(asked).toEqual([])
    await run('Read', { path: join(cwd, '../elsewhere/x.md') })
    expect(asked).toEqual(['Read'])
  })
})
