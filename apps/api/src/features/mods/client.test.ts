import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createScriptVms } from '@localixai/engine-scripts'
import { defaultErrorHandler } from '@localixai/mini-app-sdk/backend'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { INERT_MOD_PORTS, type ModSource, type ModsPorts } from './contracts'
import { createModsHost } from './host'
import { instanceIdOf } from './instance-id'
import { createModRoutes } from './routes'

const scratch = tempDirPerTest('mods-client', {})

/** A pane with a spinner its surface module draws; posts come back as `ui.message`. */
const SPINNER_MOD = `
// What its hooks heard goes to the conversation's log, which the test reads.
const heard = ($, line) => $.ui.log(JSON.stringify(line))
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.ui.open({ id: 'spin', title: 'Spin' })
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: 'spin' }, async ($, e) => {
    const { Box, Client } = $.ui.resolve(e)
    return <Box><Client key="wheel" module="./client/wheel.tsx" props={{ speed: 2 }} height={3} /></Box>
  })
  on('ui.message', async ($, e, next) => {
    heard($, { plugin: 'spinner', event: e, origin: next.origin })
    const answered = await next(e)
    return { ...answered, props: { speed: e.data.faster ? 9 : 1 } }
  })
  on('ui.fault', async ($, e, next) => {
    heard($, { plugin: 'spinner', fault: e })
    return next(e)
  })
}
`

/** A wheel that turns: a surface module, with a helper of its own plugin. */
const WHEEL = `
import { frames } from './frames'
export default function Wheel(props, surface) {
  const { Text } = surface.elements
  return <Text>{frames[(surface.state ?? 0) % frames.length]} {props.speed}</Text>
}
`

/** Another plugin's hooks in the same project, which must not hear the spinner's posts. */
const BYSTANDER_MOD = `
export function register(on) {
  on('ui.message', async ($, e, next) => {
    $.ui.log(JSON.stringify({ plugin: 'bystander' }))
    return next(e)
  })
}
`

function setup(files: Record<string, string>, extra: Record<string, string> = {}) {
  const dir = scratch()
  const heard: unknown[] = []
  const changes: number[] = []
  const reports: string[] = []
  const ports: ModsPorts = {
    dataDir: (plugin) => join(dir, 'data', plugin),
    workspaceDir: dir,
    submitPrompt: async () => {},
    complete: INERT_MOD_PORTS.complete,
    log: (_scene, line) => heard.push(JSON.parse(line.text)),
    notify: () => {},
    changed: () => changes.push(1),
    report: (plugin, message) => reports.push(`${plugin}: ${message}`),
  }
  const sourceOf = (plugin: string, tree: Record<string, string>): ModSource => {
    const root = join(dir, plugin)
    writeTree(root, tree)
    return { plugin, root, module: join(root, 'hooks/register.tsx'), options: {}, revision: '1' }
  }
  const sources = [sourceOf('spinner', files)]
  if (extra['hooks/register.tsx']) sources.push(sourceOf('bystander', extra))
  const host = createModsHost(ports, { vms: createScriptVms() })
  const app = new Hono().route('/', createModRoutes(host))
  app.onError(defaultErrorHandler)
  return { dir, host, app, sources, heard, changes, reports }
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('Client', () => {
  test('its surface module is read at load, served bundled, and posts reach only its own hooks', async () => {
    const { dir, host, app, sources, heard, changes } = setup(
      {
        'hooks/register.tsx': SPINNER_MOD,
        'hooks/client/wheel.tsx': WHEEL,
        'hooks/client/frames.ts': "export const frames = ['|', '/', '-', '\\\\']",
      },
      { 'hooks/register.tsx': BYSTANDER_MOD },
    )
    await host.reconcile(sources)
    expect(host.failures()).toEqual(new Map())
    const instance = instanceIdOf('spinner', dir)

    const drawing = await (await app.request(`/panes/${instance}/spin`)).json()
    const client = drawing.tree[0].children[0]
    const revision = client.client.revision
    expect(client).toMatchObject({
      type: 'Client',
      // The literal, rewritten at load to the module's path under the plugin.
      props: { key: 'wheel', module: 'hooks/client/wheel.tsx', props: { speed: 2 }, height: 3 },
      client: { revision: expect.any(String) },
    })

    const served = await app.request(
      `/clients/${instance}?module=${encodeURIComponent('hooks/client/wheel.tsx')}`,
    )
    const bundle = await served.json()
    expect(bundle.revision).toBe(revision)
    expect(bundle.code).toContain("Symbol.for('localix.mods.client')".replace(/'/g, '"'))
    expect(bundle.code).toContain("'|', '/', '-'".replace(/'/g, '"'))
    // The frame's own `h` draws its JSX; nothing of the app's is bundled in.
    expect(bundle.code).toContain('h(Text')
    expect((await app.request(`/clients/${instance}?module=hooks/register.tsx`)).status).toBe(404)

    const answered = await app.request(
      `/panes/${instance}/spin/clients/wheel/messages`,
      json({ data: { faster: true } }),
    )
    expect(await answered.json()).toEqual({ props: { speed: 9 } })
    expect(heard).toEqual([
      {
        plugin: 'spinner',
        event: {
          surface: 'desktop',
          component: 'Pane',
          requestId: 'spin',
          element: 'wheel',
          module: 'hooks/client/wheel.tsx',
          data: { faster: true },
        },
        origin: { plugin: 'client', tier: 'user' },
      },
    ])

    const gone = await app.request(
      `/panes/${instance}/spin/clients/nope/messages`,
      json({ data: 1 }),
    )
    expect(gone.status).toBe(404)

    const before = changes.length
    const faulted = await app.request(
      `/panes/${instance}/spin/clients/wheel/faults`,
      json({ phase: 'render', reason: 'boom' }),
    )
    expect(faulted.status).toBe(200)
    expect(heard.at(-1)).toMatchObject({
      fault: { element: 'wheel', phase: 'render', reason: 'boom' },
    })
    // Drawn again, so the mod's `ui.render` can leave the failed Client out.
    expect(changes.length).toBeGreaterThan(before)
    await host.stop()
  })

  test('a post that is not plain data is refused', async () => {
    const { dir, host, app, sources } = setup({
      'hooks/register.tsx': SPINNER_MOD,
      'hooks/client/wheel.tsx': WHEEL,
      'hooks/client/frames.ts': 'export const frames = ["|"]',
    })
    await host.reconcile(sources)
    const instance = instanceIdOf('spinner', dir)
    await app.request(`/panes/${instance}/spin`)
    const deep = JSON.parse('['.repeat(40) + ']'.repeat(40))
    const refused = await app.request(
      `/panes/${instance}/spin/clients/wheel/messages`,
      json({ data: deep }),
    )
    expect(refused.status).toBe(422)
    await host.stop()
  })

  test('a module not written as a literal, outside the plugin or naming no file is refused at load', async () => {
    const cases: Array<[string, string]> = [
      [
        'const m = "./w.tsx"\nexport const register = () => Client({ key: "a", module: m })',
        'string literal',
      ],
      [
        'export const register = () => <Client key="a" module="../../x.tsx" />',
        'inside the plugin',
      ],
      [
        'export const register = () => <Client key="a" module="./missing.tsx" />',
        'inside the plugin',
      ],
      ['export const register = () => Client({ key: "a", module: "./w.css" })', 'not a ./ path'],
    ]
    for (const [code, why] of cases) {
      const { host, sources } = setup({ 'hooks/register.tsx': code })
      await host.reconcile(sources)
      expect(host.failures().get('spinner')).toContain(why)
      expect(host.failures().get('spinner')).toContain('hooks/register.tsx:')
      await host.stop()
    }
  })

  test('a surface module that imports outside its plugin is served as a problem, not code', async () => {
    const { dir, host, app, sources } = setup({
      'hooks/register.tsx': SPINNER_MOD,
      'hooks/client/wheel.tsx': "import x from 'left-pad'\nexport default () => x",
    })
    await host.reconcile(sources)
    expect(host.failures()).toEqual(new Map())
    const instance = instanceIdOf('spinner', dir)
    const bundle = await (
      await app.request(`/clients/${instance}?module=hooks/client/wheel.tsx`)
    ).json()
    expect(bundle.code).toBeUndefined()
    expect(bundle.problem).toContain('left-pad')
    await host.stop()
  })
})
