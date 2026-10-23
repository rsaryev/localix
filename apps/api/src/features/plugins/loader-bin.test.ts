import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { AvailabilityReader } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'

import { loadEnabledPlugins } from './loader'

// An enabled plugin's `<dir>/bin` directory is collected into LoadedPlugins.binDirs
// so the bash tool can append it to PATH (Claude Code's `bin/`-on-PATH convention).
// A plugin without a `bin/` dir contributes nothing.

const emptyRepo: CapabilitySourceRepository = {
  listForScope: async () => [],
  get: async () => null,
  upsert: async () => ({
    id: 'x',
    userId: 'u',
    projectId: '',
    name: 'x',
    enabled: false,
    config: {},
    source: 'local',
    createdAt: '',
    updatedAt: '',
  }),
  patchConfig: async (_userId, projectId, name, patch) => ({
    id: 'x',
    userId: 'u',
    projectId,
    name,
    enabled: false,
    config: patch,
    source: 'local',
    createdAt: '',
    updatedAt: '',
  }),
  remove: async () => {},
}

/** Every plugin switched on, as a rule allowing it would. */
const ALL_ON: AvailabilityReader = { effectFor: () => 'allow' }

let home: string

/** A plugin with one command in `<home>/.localix/plugins/<name>`. */
async function writePlugin(name: string): Promise<string> {
  const pluginDir = join(home, '.localix', 'plugins', name)
  await fs.mkdir(join(pluginDir, '.claude-plugin'), { recursive: true })
  await fs.mkdir(join(pluginDir, 'commands'), { recursive: true })
  await fs.writeFile(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: name }),
  )
  await fs.writeFile(join(pluginDir, 'commands', 'go.md'), '---\ndescription: go\n---\nGo')
  return pluginDir
}

beforeAll(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'plugin-bin-home-'))
  // A plugin WITH a bin/ dir…
  const withBin = await writePlugin('has-bin')
  await fs.mkdir(join(withBin, 'bin'), { recursive: true })
  await fs.writeFile(join(withBin, 'bin', 'my-cli'), '#!/usr/bin/env node\nconsole.log("hi")\n')
  // …and one with none.
  await writePlugin('no-bin')
})

afterAll(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

describe('loadEnabledPlugins binDirs', () => {
  it("collects an enabled plugin's existing bin/ dir", async () => {
    const loaded = await loadEnabledPlugins({
      availability: ALL_ON,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    expect(loaded.binDirs).toContain(join(home, '.localix/plugins', 'has-bin', 'bin'))
  })

  it('does not add a bin dir for a plugin without one', async () => {
    const loaded = await loadEnabledPlugins({
      availability: ALL_ON,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    expect(loaded.binDirs).not.toContain(join(home, '.localix/plugins', 'no-bin', 'bin'))
  })
})
