import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { UNDECIDED } from '../capabilities/availability'
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

let bundled: string
let home: string
const prevEnv = process.env.LOCALIX_BUNDLED_PLUGINS_DIR

beforeAll(async () => {
  bundled = await fs.mkdtemp(join(tmpdir(), 'plugin-bin-'))
  home = await fs.mkdtemp(join(tmpdir(), 'plugin-bin-home-'))

  // A command-only bundled plugin (default-enabled, no DB row) WITH a bin/ dir.
  const withBin = join(bundled, 'has-bin')
  await fs.mkdir(join(withBin, 'bin'), { recursive: true })
  await fs.writeFile(
    join(withBin, 'plugin.json'),
    JSON.stringify({
      name: 'has-bin',
      version: '1.0.0',
      description: 'ships a CLI',
      commands: [{ name: 'go', description: 'go', prompt: 'Go' }],
    }),
  )
  await fs.writeFile(join(withBin, 'bin', 'my-cli'), '#!/usr/bin/env node\nconsole.log("hi")\n')

  // A command-only bundled plugin with NO bin/ dir.
  const noBin = join(bundled, 'no-bin')
  await fs.mkdir(noBin, { recursive: true })
  await fs.writeFile(
    join(noBin, 'plugin.json'),
    JSON.stringify({
      name: 'no-bin',
      version: '1.0.0',
      description: 'no CLI',
      commands: [{ name: 'go', description: 'go', prompt: 'Go' }],
    }),
  )

  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = bundled
})

afterAll(async () => {
  if (prevEnv === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevEnv
  await fs.rm(bundled, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
})

describe('loadEnabledPlugins binDirs', () => {
  it("collects an enabled plugin's existing bin/ dir", async () => {
    const loaded = await loadEnabledPlugins({
      availability: UNDECIDED,
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
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    expect(loaded.binDirs).not.toContain(join(home, '.localix/plugins', 'no-bin', 'bin'))
  })
})
