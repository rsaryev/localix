import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { MANIFEST_FILE } from '@localixai/claude-plugin'
import { tempDirPerTest } from '@localixai/testing'

import { loadManifest } from './discovery'
import { emptyLoadedPlugins } from './loader-contract'
import { appendPluginRuntimeDeclarations } from './loader-runtime-declarations'
import { validatePluginAgents } from './validate-fields'

/**
 * Claude Code puts no limit on a plugin's agents; Localix used to keep the first eight and drop
 * the rest silently, and a manifest listing more than eight agent files failed to parse.
 */
const dir = tempDirPerTest('agents-uncapped-')
const COUNT = 12
const names = Array.from({ length: COUNT }, (_, i) => `agent-${String(i + 1).padStart(2, '0')}`)

async function write(rel: string, content: string | object): Promise<void> {
  const file = join(dir(), rel)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
}

async function writeAgents(folder: string): Promise<void> {
  for (const name of names)
    await write(
      `${folder}/${name}.md`,
      `---\nname: ${name}\ndescription: ${name}\n---\n\nYou are ${name}.\n`,
    )
}

describe('a plugin with more than eight agents', () => {
  test('loads every file in its agents/ folder', async () => {
    await write(MANIFEST_FILE, { name: 'crew' })
    await writeAgents('agents')
    const plugin = await loadManifest(dir(), 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.agents.map((agent) => agent.name)).toEqual(names)
    expect(plugin.provides.agents).toEqual(names.map((name) => `crew:${name}`))
    expect(validatePluginAgents(plugin).warnings).toEqual([])
  })

  test('loads every agent file its manifest lists', async () => {
    await write(MANIFEST_FILE, {
      name: 'crew',
      agents: names.map((name) => `./roles/${name}.md`),
    })
    await writeAgents('roles')
    const plugin = await loadManifest(dir(), 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.agents).toHaveLength(COUNT)
  })

  test('the plugin’s `settings.agent` may name its twelfth agent', async () => {
    await write(MANIFEST_FILE, { name: 'crew' })
    await writeAgents('agents')
    await write('settings.json', { agent: names[COUNT - 1] })
    const plugin = await loadManifest(dir(), 'global', '')
    const result = emptyLoadedPlugins()
    appendPluginRuntimeDeclarations({
      plugin,
      config: {},
      subst: (text) => text,
      result,
      summary: {
        name: 'crew',
        scope: 'global',
        description: '',
        skills: [],
        mcpServers: [],
      },
      opts: { homeDir: dir() },
    })
    expect(result.mainAgent?.fullName).toBe(`crew:${names[COUNT - 1]}`)
  })
})
