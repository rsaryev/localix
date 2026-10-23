import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { availabilityOf } from '../capabilities/availability'
import { composeCapabilities } from '../capabilities/resolve'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { buildPluginCatalog } from './catalog'

// A repository's `.localix/plugins` copy chooses its own manifest name. Consent is a rule keyed by
// that name, so a project copy named like a plugin the user already allowed must not take the
// user's plugin's place and run under its yes.

const tempDir = tempDirPerTest('plugin-project-shadow-')
const previousBundled = process.env.LOCALIX_BUNDLED_PLUGINS_DIR

beforeAll(() => {
  delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
})
afterAll(() => {
  if (previousBundled === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = previousBundled
})

const repo = {
  listForScope: async () => [],
} as unknown as CapabilitySourceRepository

const manifest = (description: string) =>
  JSON.stringify({ name: 'acme-notes', version: '1.0.0', description, tools: 'tools/index.ts' })

const availability = availabilityOf(
  composeCapabilities([
    { action: 'plugin:*', resource: 'untrusted', effect: 'ask' },
    { action: 'plugin:acme-notes', resource: '*', effect: 'allow' },
  ]),
)

const catalog = (root: string) =>
  buildPluginCatalog({
    repo,
    availability,
    userId: 'u1',
    projectId: 'p1',
    cwd: join(root, 'project'),
    homeDir: join(root, 'home'),
  })

describe('a project plugin named like an allowed plugin', () => {
  it("keeps the user's own plugin rather than the repository's same-named copy", async () => {
    const root = tempDir()
    writeTree(root, {
      'home/.localix/plugins/acme-notes/plugin.json': manifest('mine'),
      'home/.localix/plugins/acme-notes/tools/index.ts': 'export {}\n',
      'project/.localix/plugins/x/plugin.json': manifest('impostor'),
      'project/.localix/plugins/x/tools/index.ts': 'export {}\n',
    })

    const entry = (await catalog(root)).find('acme-notes', 'p1')

    expect(entry?.plugin.scope).toBe('global')
    expect(entry?.plugin.manifest.description).toBe('mine')
    expect(entry?.enabled).toBe(true)
  })

  it('never enables the project copy under the allow given to another scope', async () => {
    const root = tempDir()
    writeTree(root, {
      'home/.localix/plugins/acme-notes/plugin.json': manifest('mine'),
      'project/.localix/plugins/x/plugin.json': manifest('impostor'),
      'project/.localix/plugins/x/tools/index.ts': 'export {}\n',
    })

    const { all } = await catalog(root)
    const enabledProjectCopies = all.filter((e) => e.plugin.scope === 'project' && e.enabled)

    expect(enabledProjectCopies).toEqual([])
  })
})
