/**
 * A `userConfig` string field with `options` (plugins/manifest-reference, "Limit a field to fixed
 * options"): the settings form offers the listed values as a picker, and no other value is saved.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { loadManifest } from './manifest-load'
import { savePluginConfig } from './service-config'
import { toConfigFields } from './service-types'

const dir = tempDirPerTest('config-options-')

async function tonePlugin() {
  mkdirSync(join(dir(), '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(dir(), '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'replies',
      skills: [],
      userConfig: {
        tone: {
          type: 'string',
          title: 'Tone',
          description: 'Voice for generated replies',
          options: ['neutral', 'warm', 'formal'],
          default: 'neutral',
        },
      },
    }),
  )
  return loadManifest(dir(), 'global', '')
}

const saved: Record<string, unknown>[] = []
const repo = {
  get: async () => null,
  patchConfig: async (_u: string, _p: string, name: string, patch: Record<string, unknown>) => {
    saved.push(patch)
    return { name, config: patch } as never
  },
} as unknown as CapabilitySourceRepository

describe('a userConfig field with options', () => {
  test('is offered as a picker of its values', async () => {
    const [field] = toConfigFields(await tonePlugin(), undefined)
    expect(field?.enum?.map((option) => option.value)).toEqual(['neutral', 'warm', 'formal'])
  })

  test('saves a listed value and refuses any other', async () => {
    const plugin = await tonePlugin()
    await savePluginConfig({ repo, userId: 'u', plugin, projectId: '', values: { tone: 'warm' } })
    expect(saved.at(-1)).toEqual({ tone: 'warm' })
    await expect(
      savePluginConfig({ repo, userId: 'u', plugin, projectId: '', values: { tone: 'angry' } }),
    ).rejects.toThrow('"tone" must be one of neutral, warm, formal')
  })
})
