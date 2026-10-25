import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import type { LoadedPluginAgent } from '../../plugins/loader-contract'
import { agentFolders, scanAgents } from './scan'

// settings-reference.md, `strictPluginOnlyCustomization.agents`: agents of `~/.claude/agents/` and
// `.claude/agents/` do not load; built-in agents, the managed policy folder's and plugins' still do.
// (An agent's frontmatter `hooks` do not run in Localix at all, so a `hooks` lock has nothing to take.)
const base = tempDirPerTest('agent-lock-')
const agent = (name: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${name} agent\n${extra}---\nYou are ${name}.`
const plugin: LoadedPluginAgent = {
  pluginName: 'acme',
  name: 'helper',
  fullName: 'acme:helper',
  label: 'helper',
  description: 'from a plugin',
  prompt: 'You help.',
}

async function scan(policy: unknown) {
  writeTree(base(), {
    'home/.claude/agents/mine.md': agent('mine'),
    'repo/.claude/agents/proj.md': agent('proj'),
    'managed/.claude/agents/org.md': agent('org'),
    'managed/managed-settings.json': JSON.stringify(policy),
  })
  const folders = await agentFolders({
    cwd: join(base(), 'repo'),
    home: join(base(), 'home'),
    managedDir: join(base(), 'managed'),
  })
  return scanAgents({ folders, projectId: 'p', plugins: [plugin] })
}
const names = (c: Awaited<ReturnType<typeof scan>>) =>
  c.active
    .filter((a) => a.source !== 'builtin')
    .map((a) => a.fullName)
    .sort()

describe('agents under strictPluginOnlyCustomization', () => {
  test('unlocked, every source loads', async () => {
    expect(names(await scan({}))).toEqual(['acme:helper', 'mine', 'org', 'proj'])
  })

  test('agents locked: the person’s and the project’s files do not load', async () => {
    const catalog = await scan({ strictPluginOnlyCustomization: ['agents'] })
    expect(names(catalog)).toEqual(['acme:helper', 'org'])
    expect(catalog.active.some((a) => a.source === 'builtin')).toBe(true)
  })

  test('another kind locked leaves agents loading', async () => {
    expect(names(await scan({ strictPluginOnlyCustomization: ['skills', 'mcp'] }))).toEqual([
      'acme:helper',
      'mine',
      'org',
      'proj',
    ])
  })
})
