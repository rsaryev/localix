/**
 * The `commands` object map in `plugin.json` (plugins/manifest-reference, `commands`): each key is
 * the command's name, the entry's fields describe it, and the map replaces the `commands/` scan.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { loadManifest } from './manifest-load'

const dir = tempDirPerTest('command-map-')

function plugin(manifest: unknown, files: Record<string, string> = {}): string {
  const all = { '.claude-plugin/plugin.json': JSON.stringify(manifest), ...files }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir(), path)), { recursive: true })
    writeFileSync(join(dir(), path), text)
  }
  return dir()
}

describe('the commands object map', () => {
  test('names a command from a file after its key, with the entry’s description and hint', async () => {
    const root = plugin(
      {
        name: 'deploy-tools',
        commands: {
          status: {
            source: './commands/stat.md',
            description: 'Show the current deployment status',
            argumentHint: '[env]',
            model: 'haiku',
            allowedTools: ['Bash(kubectl get:*)'],
          },
        },
      },
      { 'commands/stat.md': '---\ndescription: old text\n---\nReport the status of $ARGUMENTS.' },
    )
    const { commands } = await loadManifest(root, 'global', '')
    expect(commands.map((command) => command.name)).toEqual(['status'])
    expect(commands[0]).toMatchObject({
      description: 'Show the current deployment status',
      argumentHint: '[env]',
      model: 'haiku',
      allowedTools: ['Bash(kubectl get:*)'],
      prompt: 'Report the status of $ARGUMENTS.',
    })
  })

  test('replaces the commands/ folder, even when every entry is inline', async () => {
    const root = plugin(
      { name: 'p', commands: { about: { content: 'Explain this plugin.' } } },
      { 'commands/other.md': '---\ndescription: other\n---\nOther.' },
    )
    const { commands } = await loadManifest(root, 'global', '')
    expect(commands.map((command) => command.name)).toEqual(['about'])
  })
})
