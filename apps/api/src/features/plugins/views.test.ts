import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { AvailabilityReader } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

import { buildPluginCatalog } from './catalog'
import { listViewsFromCatalog, readViewHtml } from './views'
import { PLUGIN_VIEW_HTML_CAP_BYTES } from './contracts'

function fakeRepo(rows: CapabilitySourceRecord[]): CapabilitySourceRepository {
  const byKey = new Map(rows.map((r) => [`${r.projectId}:${r.name}`, r]))
  return {
    listForScope: async (_u, projectId) =>
      [...byKey.values()].filter((r) => r.projectId === '' || r.projectId === projectId),
    get: async (_u, projectId, name) => byKey.get(`${projectId}:${name}`) ?? null,
    upsert: async (_u, projectId, name) => byKey.get(`${projectId}:${name}`)!,
    patchConfig: async (_u, projectId, name, patch) => {
      const key = `${projectId}:${name}`
      const current = byKey.get(key)!
      const next = { ...current, config: { ...current.config, ...patch } }
      byKey.set(key, next)
      return next
    },
    remove: async () => {},
  }
}

const state = (name: string): CapabilitySourceRecord => ({
  id: name,
  userId: 'u1',
  projectId: 'p1',
  name,
  config: {},
  source: 'local',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

let dir: string
const prevBundled = process.env.LOCALIX_BUNDLED_PLUGINS_DIR
/**
 * The catalog for exactly these plugins. Availability is a rule now, so a fixture names
 * what it switched on — anything unnamed is left to the trust gate, which for a
 * dropped-in fixture plugin says off.
 */
const on = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name) => (names.includes(name) ? 'allow' : 'deny'),
})
const catalogFor = (repo: CapabilitySourceRepository, ...names: string[]) =>
  buildPluginCatalog({
    availability: on(...names),
    repo,
    userId: 'u1',
    projectId: 'p1',
    cwd: dir,
    homeDir: join(dir, 'home'),
  })

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'plugin-views-'))
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = await fs.mkdtemp(
    join(tmpdir(), 'plugin-views-bundled-'),
  )

  const mon = join(dir, '.localix', 'plugins', 'mon')
  await fs.mkdir(join(mon, 'views'), { recursive: true })
  await fs.writeFile(
    join(mon, 'plugin.json'),
    JSON.stringify({
      name: 'mon',
      version: '1.0.0',
      description: 'views demo',
      views: [
        {
          id: 'dash',
          title: 'Dashboard',
          // A pre-unification manifest still naming a surface: the field is dropped,
          // not rejected — every view opens as a work-item tab now.
          surface: 'rail',
          file: './views/dash.html',
          icon: 'gauge',
          agentDescription: 'Open the monitoring dashboard when live metrics would help.',
        },
        { id: 'panel', title: 'Panel', file: './views/panel.html' },
        { id: 'empty', title: 'Empty', file: './views/empty.html' },
        { id: 'huge', title: 'Huge', file: './views/huge.html' },
      ],
    }),
  )
  await fs.writeFile(join(mon, 'views', 'dash.html'), '<h1>Dash</h1>')
  await fs.writeFile(join(mon, 'views', 'panel.html'), '<h1>Panel</h1>')
  await fs.writeFile(join(mon, 'views', 'empty.html'), '   ')
  await fs.writeFile(join(mon, 'views', 'huge.html'), 'x'.repeat(PLUGIN_VIEW_HTML_CAP_BYTES + 1))

  // A plugin still on the LEGACY `panels` contract — promoted into `views` at parse
  // (`name` becomes the view id), which is the whole point of keeping one surface.
  const legacy = join(dir, '.localix', 'plugins', 'legacy')
  await fs.mkdir(join(legacy, 'panels'), { recursive: true })
  await fs.writeFile(
    join(legacy, 'plugin.json'),
    JSON.stringify({
      name: 'legacy',
      version: '1.0.0',
      description: 'legacy panels demo',
      panels: [
        {
          name: 'board',
          title: 'Board',
          file: './panels/board.html',
          agentDescription: 'Open the plugin board when its dashboard would help.',
        },
      ],
    }),
  )
  await fs.writeFile(join(legacy, 'panels', 'board.html'), '<h1>Board</h1>')

  // A manifest whose view file escapes the plugin dir (security).
  const evil = join(dir, '.localix', 'plugins', 'evil')
  await fs.mkdir(evil, { recursive: true })
  await fs.writeFile(
    join(evil, 'plugin.json'),
    JSON.stringify({
      name: 'evil',
      version: '1.0.0',
      description: 'escape attempt',
      views: [{ id: 'leak', title: 'Leak', file: '../../../../../../etc/hosts' }],
    }),
  )

  // A manifest with an invalid view id — schema rejects → plugin gets an error.
  const bad = join(dir, '.localix', 'plugins', 'bad')
  await fs.mkdir(bad, { recursive: true })
  await fs.writeFile(
    join(bad, 'plugin.json'),
    JSON.stringify({
      name: 'bad',
      version: '1.0.0',
      description: 'bad view id',
      views: [{ id: 'not a valid id', title: 'X', file: './x.html' }],
    }),
  )
})

afterAll(async () => {
  if (prevBundled === undefined) delete process.env.LOCALIX_BUNDLED_PLUGINS_DIR
  else process.env.LOCALIX_BUNDLED_PLUGINS_DIR = prevBundled
  await fs.rm(dir, { recursive: true, force: true })
})

describe('plugin views', () => {
  it('lists views of enabled plugins, namespaced, with icon and no surface', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon')]), 'mon')
    const views = listViewsFromCatalog(catalog, 'p1')
    expect(views.slice(0, 2)).toEqual([
      {
        pluginName: 'mon',
        projectId: 'p1',
        id: 'dash',
        fullName: 'mon:dash',
        title: 'Dashboard',
        icon: 'gauge',
        agentDescription: 'Open the monitoring dashboard when live metrics would help.',
      },
      { pluginName: 'mon', projectId: 'p1', id: 'panel', fullName: 'mon:panel', title: 'Panel' },
    ])
  })

  it('promotes a legacy `panels` array into views, keyed by the panel name', async () => {
    const catalog = await catalogFor(fakeRepo([state('legacy')]), 'legacy')
    expect(listViewsFromCatalog(catalog, 'p1')).toEqual([
      {
        pluginName: 'legacy',
        projectId: 'p1',
        id: 'board',
        fullName: 'legacy:board',
        title: 'Board',
        agentDescription: 'Open the plugin board when its dashboard would help.',
      },
    ])
    const { html } = await readViewHtml(catalog, { pluginName: 'legacy', viewId: 'board' })
    expect(html).toContain('<h1>Board</h1>')
  })

  it('a plugin the rules switched off contributes no views and serves no HTML', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon')]))
    expect(listViewsFromCatalog(catalog, 'p1')).toEqual([])
    expect(readViewHtml(catalog, { pluginName: 'mon', viewId: 'dash' })).rejects.toThrow(
      'not enabled',
    )
  })

  it('serves a view HTML file', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon')]), 'mon')
    const { html } = await readViewHtml(catalog, { pluginName: 'mon', viewId: 'dash' })
    expect(html).toContain('<h1>Dash</h1>')
  })

  it('rejects unknown views, empty and oversized files, and a path escape', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon'), state('evil')]), 'mon', 'evil')
    expect(readViewHtml(catalog, { pluginName: 'mon', viewId: 'nope' })).rejects.toThrow('no view')
    expect(readViewHtml(catalog, { pluginName: 'mon', viewId: 'empty' })).rejects.toThrow('empty')
    expect(readViewHtml(catalog, { pluginName: 'mon', viewId: 'huge' })).rejects.toThrow('exceeds')
    expect(readViewHtml(catalog, { pluginName: 'evil', viewId: 'leak' })).rejects.toThrow(
      'inside the plugin directory',
    )
  })

  it('a manifest with an invalid view id fails validation (plugin gets an error)', async () => {
    const catalog = await catalogFor(fakeRepo([state('bad')]), 'bad')
    const entry = [...catalog.all].find(({ plugin }) => plugin.manifest.name === 'bad')
    expect(entry?.plugin.error ?? '').not.toBe('')
    expect(listViewsFromCatalog(catalog, 'p1').filter((v) => v.pluginName === 'bad')).toEqual([])
  })
})
