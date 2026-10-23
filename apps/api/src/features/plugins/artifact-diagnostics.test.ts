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
    expect(malformedPlugin.error).toStartWith('Invalid .claude-plugin/plugin.json:')
    expect((await validatePluginFull(malformedPlugin)).errors).toContain(malformedPlugin.error!)

    const unreadable = join(root, 'unreadable')
    await mkdir(join(unreadable, '.claude-plugin', 'plugin.json'), { recursive: true })

    const unreadablePlugin = await loadManifest(unreadable, 'global', '')
    expect(unreadablePlugin.manifest.name).toBe('unreadable')
    expect(unreadablePlugin.error).toStartWith('Cannot read .claude-plugin/plugin.json:')
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

    const plugin = await loadManifest(pluginDir, 'global', '')
    expect(plugin.error).toBeUndefined()
    expect(plugin.provides.commands).toEqual(['good'])

    const diagnostics = plugin.entrypoints.diagnostics ?? []
    expect(
      diagnostics.some(
        (item) => item.kind === 'command' && item.path.endsWith('missing-command.md'),
      ),
    ).toBe(true)
    expect(
      diagnostics.some(
        (item) => item.kind === 'command' && item.message.includes('no prompt body'),
      ),
    ).toBe(true)
    expect(
      diagnostics.some(
        (item) => item.kind === 'agent' && item.message.includes('not a regular file'),
      ),
    ).toBe(true)

    const validation = await validatePluginFull(plugin)
    expect(validation.errors.some((error) => error.includes('missing-command.md'))).toBe(true)
    expect(validation.errors.some((error) => error.includes('empty.md'))).toBe(true)
    expect(validation.errors.some((error) => error.includes('not-an-agent.md'))).toBe(true)
  })
})
