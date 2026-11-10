import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadManifest } from './discovery'
import { validatePluginFull } from './validate'

let root: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'plugin-artifact-diagnostics-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('plugin artifact diagnostics', () => {
  test('distinguishes malformed JSON from an unreadable plugin.json and keeps discovery alive', async () => {
    const malformed = join(root, 'malformed')
    await mkdir(join(malformed, '.claude-plugin'), { recursive: true })
    await writeFile(join(malformed, '.claude-plugin', 'plugin.json'), '{ definitely not json')

    const malformedPlugin = await loadManifest(malformed, 'global', '')
    expect(malformedPlugin.manifest.name).toBe('malformed')
    expect(malformedPlugin.error).toStartWith(
      '.claude-plugin/plugin.json could not be read as JSON',
    )
    expect((await validatePluginFull(malformedPlugin)).errors).toContain(malformedPlugin.error!)

    const unreadable = join(root, 'unreadable')
    await mkdir(join(unreadable, '.claude-plugin', 'plugin.json'), { recursive: true })

    const unreadablePlugin = await loadManifest(unreadable, 'global', '')
    expect(unreadablePlugin.manifest.name).toBe('unreadable')
    expect(unreadablePlugin.error).toContain('the file could not be read')
  })

  test('surfaces bad markdown while retaining valid sibling artifacts', async () => {
    const pluginDir = join(root, 'mixed-artifacts')
    await mkdir(join(pluginDir, 'commands'), { recursive: true })
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
    await mkdir(join(pluginDir, 'not-an-agent.md'), { recursive: true })
    await writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'mixed-artifacts',
        version: '1.0.0',
        description: 'mixed valid and invalid artifacts',
        // Listed commands replace the default folder, as in Claude Code: list it too.
        commands: ['./commands', './missing-command.md'],
        agents: ['./not-an-agent.md'],
      }),
    )
    await writeFile(
      join(pluginDir, 'commands', 'good.md'),
      '---\ndescription: Still loads\n---\nRun the valid sibling.',
    )
    await writeFile(
      join(pluginDir, 'commands', 'empty.md'),
      '---\ndescription: Missing body\n---\n',
    )

    // Behaviour change (kit wins): a command file with an empty body loads, as Claude Code loads it.
    const plugin = await loadManifest(pluginDir, 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.commands.sort()).toEqual(['empty', 'good'])

    const validation = await validatePluginFull(plugin)
    const found = [...validation.errors, ...validation.warnings]
    expect(found.some((message) => message.includes('missing-command.md'))).toBe(true)
    expect(found.some((message) => message.includes('not-an-agent.md'))).toBe(true)
  })
})
