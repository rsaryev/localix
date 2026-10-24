/**
 * How Claude Code names and loads a plugin's agent file (plugins/components, "Frontmatter fields
 * in plugin agents"): a file whose frontmatter is missing or does not parse still loads, named
 * after the file and described as `Agent from <plugin> plugin`; a `name` longer than 256
 * characters is ignored the same way.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { buildLoadedAgent } from './loader-contract'
import { loadManifest } from './manifest-load'

const dir = tempDirPerTest('agent-file-rules-')

async function agentsOf(files: Record<string, string>) {
  const all = { '.claude-plugin/plugin.json': JSON.stringify({ name: 'my-plugin' }), ...files }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir(), path)), { recursive: true })
    writeFileSync(join(dir(), path), text)
  }
  const { agents } = await loadManifest(dir(), 'global', '')
  return agents
    .map((agent) => buildLoadedAgent('my-plugin', agent, (text) => text))
    .map(({ name, description }) => ({ name, description }))
}

describe('a plugin agent file', () => {
  test('with no frontmatter loads, named after the file', async () => {
    expect(await agentsOf({ 'agents/helper.md': 'You help with releases.' })).toEqual([
      { name: 'helper', description: 'Agent from my-plugin plugin' },
    ])
  })

  test('whose frontmatter does not parse loads with every field ignored', async () => {
    const broken = '---\nname: [unclosed\ndescription: : :\n---\nYou review code.'
    const [agent] = await agentsOf({ 'agents/reviewer.md': broken })
    expect(agent?.name).toBe('reviewer')
  })

  test('with a name longer than 256 characters is named after the file', async () => {
    const long = `---\nname: ${'a'.repeat(257)}\ndescription: Checks\n---\nCheck things.`
    expect(await agentsOf({ 'agents/checker.md': long })).toEqual([
      { name: 'checker', description: 'Checks' },
    ])
  })
})
