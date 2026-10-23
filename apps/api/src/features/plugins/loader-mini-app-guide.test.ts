import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { UNDECIDED } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'

import { loadEnabledPlugins } from './loader'

// An enabled mini app's guide reaches the agent through `mini_app_guide` (LoadedPlugins
// .miniAppGuides), and only a guide inside the app's own folder does. A plugin has no guide.

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

const app = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  version: '1.0.0',
  description: `The ${name} app`,
  commands: { go: { description: 'go', prompt: 'Go' } },
  ...extra,
})

beforeAll(async () => {
  bundled = await fs.mkdtemp(join(tmpdir(), 'mini-app-guide-'))
  home = await fs.mkdtemp(join(tmpdir(), 'mini-app-guide-home-'))
  const write = async (rel: string, text: string) => {
    await fs.mkdir(join(bundled, rel, '..'), { recursive: true })
    await fs.writeFile(join(bundled, rel), text)
  }
  await write('notes/mini-app.json', JSON.stringify(app('notes')))
  await write('notes/guide.md', 'Use the notes tool.\n')
  await write('escape/mini-app.json', JSON.stringify(app('escape', { guide: '../notes/guide.md' })))
  await write('cc/.claude-plugin/plugin.json', JSON.stringify({ name: 'cc' }))
  await write('cc/guide.md', 'Not a guide: this is a plugin.\n')
  await write('cc/commands/go.md', 'Go\n')
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = bundled
})

afterAll(async () => {
  if (prevEnv === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevEnv
  await fs.rm(bundled, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
})

describe('loadEnabledPlugins miniAppGuides', () => {
  it("collects an enabled mini app's guide and nothing for a plugin or an escaping path", async () => {
    const loaded = await loadEnabledPlugins({
      availability: UNDECIDED,
      repo: emptyRepo,
      userId: 'u',
      projectId: '',
      cwd: '/',
      homeDir: home,
    })
    expect(loaded.miniAppGuides).toEqual([
      { app: 'notes', file: join(home, '.localix/plugins', 'notes', 'guide.md') },
    ])
  })
})
