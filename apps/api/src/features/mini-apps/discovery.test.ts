import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { discoverMiniApps, MINI_APPS_SUBDIR } from './discovery'

const home = tempDirPerTest('mini-apps-home-')
const project = tempDirPerTest('mini-apps-project-')

const manifest = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name,
    version: '1.0.0',
    description: `The ${name} app`,
    backend: './backend/index.ts',
    ...extra,
  })

const app = (name: string, extra: Record<string, unknown> = {}) => ({
  [`${name}/mini-app.json`]: manifest(name, extra),
  [`${name}/backend/index.ts`]: 'export const tools = []\n',
  [`${name}/guide.md`]: 'How to use it.\n',
})

const under = (root: string, tree: Record<string, string>) =>
  writeTree(
    join(root, MINI_APPS_SUBDIR),
    Object.fromEntries(Object.entries(tree).map(([path, text]) => [path, text])),
  )

describe('discoverMiniApps', () => {
  test('reads each mini-app.json folder under the home mini apps root', async () => {
    under(home(), app('notes'))
    const [notes, ...rest] = await discoverMiniApps({ homeDir: home() })
    expect(rest).toEqual([])
    const dir = join(home(), MINI_APPS_SUBDIR, 'notes')
    expect(notes).toMatchObject({
      name: 'notes',
      dir,
      scope: 'global',
      projectId: '',
      backendEntries: [join(dir, 'backend/index.ts')],
      guide: join(dir, 'guide.md'),
    })
    // No `guide/` folder, so no pages to offer.
    expect(notes!.pages).toBeUndefined()
    expect(notes!.error).toBeUndefined()
    expect(notes!.manifest?.description).toBe('The notes app')
  })

  test('a folder that also holds a plugin is refused, and says why', async () => {
    under(home(), {
      ...app('mixed'),
      'mixed/.claude-plugin/plugin.json': JSON.stringify({ name: 'mixed' }),
    })
    const [mixed] = await discoverMiniApps({ homeDir: home() })
    expect(mixed!.error).toContain('.claude-plugin/plugin.json')
    expect(mixed!.backendEntries).toEqual([])
  })

  test('an invalid manifest is an error named after the folder', async () => {
    under(home(), { 'broken/mini-app.json': manifest('broken', { skills: './skills' }) })
    const [broken] = await discoverMiniApps({ homeDir: home() })
    expect(broken).toMatchObject({ name: 'broken', manifest: null })
    expect(broken!.error).toContain('skills')
  })

  test('a backend outside the folder never runs', async () => {
    under(home(), app('escape', { backend: '../notes/backend/index.ts' }))
    const [escape] = await discoverMiniApps({ homeDir: home() })
    expect(escape!.backendEntries).toEqual([])
    expect(escape!.error).toContain('backend')
  })

  test('a folder without mini-app.json is not a mini app', async () => {
    under(home(), {
      'plugin/.claude-plugin/plugin.json': JSON.stringify({ name: 'plugin' }),
      'cache/x.json': '{}',
    })
    expect(await discoverMiniApps({ homeDir: home() })).toEqual([])
  })

  test("a project's copy appears only under a name the user's own mini apps do not hold", async () => {
    under(home(), app('notes'))
    under(project(), { ...app('notes', { description: 'The project copy' }), ...app('board') })
    const found = await discoverMiniApps({
      homeDir: home(),
      cwd: project(),
      projectId: 'p1',
    })
    expect(found.map((entry) => [entry.name, entry.scope, entry.projectId])).toEqual([
      ['board', 'project', 'p1'],
      ['notes', 'global', 'p1'],
    ])
    expect(found.find((entry) => entry.name === 'notes')!.manifest?.description).toBe(
      'The notes app',
    )
  })
})
