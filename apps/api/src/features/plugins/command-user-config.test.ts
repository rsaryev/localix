/**
 * A plugin command is a skill in Claude Code, so its text takes `${user_config.KEY}` like a
 * skill's (plugins/manifest-reference, "Reference a saved value"): a saved value is pasted in, and
 * a sensitive one becomes a placeholder.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { PluginCatalog } from './catalog'
import { loadManifest } from './manifest-load'
import { catalogPluginCommands } from './plugin-skills'

const dir = tempDirPerTest('command-user-config-')

describe("a plugin command's text", () => {
  test('takes the saved ${user_config.KEY} values, a sensitive one as a placeholder', async () => {
    mkdirSync(join(dir(), '.claude-plugin'), { recursive: true })
    mkdirSync(join(dir(), 'commands'), { recursive: true })
    writeFileSync(
      join(dir(), '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'deploy',
        userConfig: {
          api_url: { type: 'string', title: 'URL', description: 'API URL' },
          api_token: { type: 'string', title: 'Token', description: 'Token', sensitive: true },
        },
      }),
    )
    writeFileSync(
      join(dir(), 'commands', 'ship.md'),
      '---\ndescription: Ship\n---\nPOST to ${user_config.api_url} with ${user_config.api_token}.',
    )
    const plugin = await loadManifest(dir(), 'global', '')
    const catalog = {
      enabled: [{ plugin, state: { config: { api_url: 'https://api.example', api_token: 'x' } } }],
    } as unknown as PluginCatalog

    const [entry] = catalogPluginCommands(catalog, { projectDir: '/repo', homeDir: dir() })
    expect(entry?.command.prompt).toBe(
      "POST to https://api.example with [sensitive option 'api_token' not available in skill content].",
    )
  })
})
