import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { AvailabilityReader } from '../capabilities/availability'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  CapabilitySourceRecord,
  CapabilitySourceRepository,
} from '../capabilities/source-repository'

import { buildMiniAppCatalog } from './catalog'
import { listViewsFromCatalog, readViewHtml } from './views'
import { MINI_APP_VIEW_HTML_CAP_BYTES } from './contracts-contributions'

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
/**
 * The catalog for exactly these mini apps. Availability is a rule, so a fixture names
 * what it switched on — anything unnamed is left to the trust gate, which for a
 * dropped-in fixture mini app says off.
 */
const on = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name) => (names.includes(name) ? 'allow' : 'deny'),
})
const catalogFor = (repo: CapabilitySourceRepository, ...names: string[]) =>
  buildMiniAppCatalog({
    availability: on(...names),
    repo,
    userId: 'u1',
    projectId: 'p1',
    cwd: dir,
    homeDir: join(dir, 'home'),
  })

beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'mini-app-views-'))

  const mon = join(dir, '.localix', 'mini-apps', 'mon')
  await fs.mkdir(join(mon, 'views'), { recursive: true })
  await fs.writeFile(
    join(mon, 'mini-app.json'),
    JSON.stringify({
      name: 'mon',
      version: '1.0.0',
      description: 'views demo',
      views: [
        {
          id: 'dash',
          title: 'Dashboard',
          // A view still naming a surface: the field is dropped, not rejected — every view
          // opens as a work-item tab.
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
  await fs.writeFile(join(mon, 'views', 'huge.html'), 'x'.repeat(MINI_APP_VIEW_HTML_CAP_BYTES + 1))

  // A manifest whose view file escapes the mini app's folder (security).
  const evil = join(dir, '.localix', 'mini-apps', 'evil')
  await fs.mkdir(evil, { recursive: true })
  await fs.writeFile(
    join(evil, 'mini-app.json'),
    JSON.stringify({
      name: 'evil',
      version: '1.0.0',
      description: 'escape attempt',
      views: [{ id: 'leak', title: 'Leak', file: '../../../../../../etc/hosts' }],
    }),
  )

  // A manifest with an invalid view id — schema rejects → the mini app gets an error.
  const bad = join(dir, '.localix', 'mini-apps', 'bad')
  await fs.mkdir(bad, { recursive: true })
  await fs.writeFile(
    join(bad, 'mini-app.json'),
    JSON.stringify({
      name: 'bad',
      version: '1.0.0',
      description: 'bad view id',
      views: [{ id: 'not a valid id', title: 'X', file: './x.html' }],
    }),
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('mini app views', () => {
  it('lists views of enabled mini apps, namespaced, with icon and no surface', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon')]), 'mon')
    const views = listViewsFromCatalog(catalog, 'p1')
    expect(views.slice(0, 2)).toEqual([
      {
        app: 'mon',
        projectId: 'p1',
        id: 'dash',
        fullName: 'mon:dash',
        title: 'Dashboard',
        icon: 'gauge',
        agentDescription: 'Open the monitoring dashboard when live metrics would help.',
      },
      { app: 'mon', projectId: 'p1', id: 'panel', fullName: 'mon:panel', title: 'Panel' },
    ])
  })

  it('a mini app the rules switched off contributes no views and serves no HTML', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon')]))
    expect(listViewsFromCatalog(catalog, 'p1')).toEqual([])
    expect(readViewHtml(catalog, { app: 'mon', viewId: 'dash' })).rejects.toThrow('not enabled')
  })

  it('serves a view HTML file', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon')]), 'mon')
    const { html } = await readViewHtml(catalog, { app: 'mon', viewId: 'dash' })
    expect(html).toContain('<h1>Dash</h1>')
  })

  it('rejects unknown views, empty and oversized files, and a path escape', async () => {
    const catalog = await catalogFor(fakeRepo([state('mon'), state('evil')]), 'mon', 'evil')
    expect(readViewHtml(catalog, { app: 'mon', viewId: 'nope' })).rejects.toThrow('no view')
    expect(readViewHtml(catalog, { app: 'mon', viewId: 'empty' })).rejects.toThrow('empty')
    expect(readViewHtml(catalog, { app: 'mon', viewId: 'huge' })).rejects.toThrow('exceeds')
    expect(readViewHtml(catalog, { app: 'evil', viewId: 'leak' })).rejects.toThrow(
      'inside the mini app folder',
    )
  })

  it('a manifest with an invalid view id fails validation (the mini app gets an error)', async () => {
    const catalog = await catalogFor(fakeRepo([state('bad')]), 'bad')
    const entry = [...catalog.all].find(({ app }) => app.name === 'bad')
    expect(entry?.app.error ?? '').not.toBe('')
    expect(listViewsFromCatalog(catalog, 'p1').filter((v) => v.app === 'bad')).toEqual([])
  })
})
