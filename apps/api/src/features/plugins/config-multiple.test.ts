/**
 * A `userConfig` string option with `multiple: true` takes a list of strings (plugins/manifest-
 * reference, "User configuration"; `pluginConfigs` stores "an array of strings"). Localix keeps
 * the list, applies a list `default`, and substitutes it into `${user_config.KEY}` and
 * `CLAUDE_PLUGIN_OPTION_<KEY>` as the items joined with commas.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { resolvePluginConfig } from './config'
import { loadManifest } from './manifest-load'
import { buildMcpRecords } from './mcp'
import { savePluginConfig } from './service-config'

const dir = tempDirPerTest('config-multiple-')

async function plugin() {
  mkdirSync(join(dir(), '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(dir(), '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'indexer',
      userConfig: {
        roots: {
          type: 'string',
          title: 'Roots',
          description: 'Folders to index',
          multiple: true,
          default: ['src', 'docs'],
        },
      },
      mcpServers: { idx: { command: 'idx', args: ['--roots=${user_config.roots}'] } },
    }),
  )
  return loadManifest(dir(), 'global', '')
}

const argsOf = (records: ReturnType<typeof buildMcpRecords>) =>
  (records[0]!.config as { command: string[] }).command.slice(1)

describe('a multiple userConfig option', () => {
  test('starts at its list default, joined with commas where it is substituted', async () => {
    const found = await plugin()
    const config = resolvePluginConfig(found.manifest, undefined)
    expect(config.roots).toBe('src,docs')
    expect(argsOf(buildMcpRecords(found, config, 'u', 'ts', dir()))).toEqual(['--roots=src,docs'])
  })

  test('saves the list the person entered and substitutes it', async () => {
    const found = await plugin()
    let stored: Record<string, unknown> = {}
    const repo = {
      get: async () => null,
      patchConfig: async (_u: string, _p: string, name: string, patch: Record<string, unknown>) => {
        stored = patch
        return { name, config: patch } as never
      },
    } as unknown as CapabilitySourceRepository
    await savePluginConfig({
      repo,
      userId: 'u',
      plugin: found,
      projectId: '',
      values: { roots: JSON.stringify(['lib', 'a,b']) },
    })
    const config = resolvePluginConfig(found.manifest, stored as never)
    expect(config.roots).toBe('lib,a,b')
    await expect(
      savePluginConfig({ repo, userId: 'u', plugin: found, projectId: '', values: { roots: 5 } }),
    ).rejects.toThrow('"roots" takes a list of strings')
  })
})
