import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { buildLoadedAgent } from '../../plugins/loader-contract'
import { readAgentFile } from './agent-file'

// sub-agents.md: `hooks`, `mcpServers` and `permissionMode` are the person's own agent files'
// to set; they are ignored for a plugin's agent "for security reasons".
describe('the frontmatter only a person’s own agent file has', () => {
  const dir = tempDirPerTest('agent-frontmatter-')
  const FILE = `---
name: guarded
description: Runs with guards
permissionMode: plan
tools: Agent(worker, researcher), Read, Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: ./check.sh
  Stop:
    - hooks:
        - type: command
          command: ./done.sh
mcpServers:
  - github
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
---
You are guarded.
`

  test('a user or project file keeps nested hooks, mcpServers and permissionMode', async () => {
    const file = join(dir(), 'guarded.md')
    await fs.writeFile(file, FILE)
    for (const source of ['user', 'project', 'managed'] as const) {
      const agent = await readAgentFile(file, source, '')
      expect(agent?.permissionMode).toBe('plan')
      expect(agent?.hooks).toMatchObject({
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './check.sh' }] }],
        Stop: [{ hooks: [{ command: './done.sh' }] }],
      })
      expect(agent?.mcpServers).toEqual([
        'github',
        { playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
      ])
      expect(agent?.agentTypes).toEqual(['worker', 'researcher'])
    }
  })

  test('a plugin’s agent loads without them', async () => {
    const file = join(dir(), 'guarded.md')
    await fs.writeFile(file, FILE)
    const { parseAgentFile } = await import('../../plugins/discovery-cc-files')
    const parsed = await parseAgentFile(file)
    const loaded = buildLoadedAgent('acme', parsed!, (text) => text)
    expect(loaded).not.toHaveProperty('hooks')
    expect(loaded).not.toHaveProperty('mcpServers')
    expect(loaded).not.toHaveProperty('permissionMode')
  })
})
