import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { PluginCatalog } from './catalog'
import type { DiscoveredPlugin } from './discovery'
import { createPluginRoutes, type PluginRoutesService } from './routes'
import { readPluginUiDescriptor, resolvePluginUiFile } from './ui-artifact'

const root = mkdtempSync(join(tmpdir(), 'plugin-ui-artifact-api-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** An installed copy of `name` whose artifact manifest is `manifest` (or none). */
function installed(
  name: string,
  { bundled = true, manifest }: { bundled?: boolean; manifest?: unknown },
) {
  const dir = join(root, name)
  write(join(dir, 'plugin.json'), JSON.stringify({ name }))
  if (manifest !== undefined)
    write(join(dir, 'dist', 'ui', 'manifest.json'), JSON.stringify(manifest))
  write(join(dir, 'dist', 'ui', 'entry.js'), 'export function registerUi() {}\n')
  write(join(dir, 'dist', 'ui', 'chunks', 'panel-abc.js'), 'export const panel = 1\n')
  return { dir, bundled, manifest: { name } } as unknown as DiscoveredPlugin
}

const catalogOf = (...plugins: (DiscoveredPlugin & { enabled?: boolean })[]) =>
  ({
    all: plugins.map((plugin) => ({ plugin, enabled: plugin.enabled ?? false })),
  }) as unknown as PluginCatalog

const artifact = { entry: 'entry.js', styles: ['entry.css', 'utilities.css'], revision: 'r1' }

describe('the plugin record ui descriptor', () => {
  test('a plugin advertises its artifact as URLs the host imports, with its revision', async () => {
    expect(await readPluginUiDescriptor(installed('demo', { manifest: artifact }))).toEqual({
      entry: '/rpc/plugins/demo/ui/entry.js',
      styles: ['/rpc/plugins/demo/ui/entry.css', '/rpc/plugins/demo/ui/utilities.css'],
      revision: 'r1',
    })
  })

  test('no artifact or a malformed manifest advertise no UI', async () => {
    expect(await readPluginUiDescriptor(installed('backend-only', {}))).toBeUndefined()
    expect(
      await readPluginUiDescriptor(installed('broken', { manifest: { entry: 1 } })),
    ).toBeUndefined()
  })

  test('a user plugin built by the app advertises its UI like a first-party one', async () => {
    const user = installed('user-built', { bundled: false, manifest: artifact })
    expect((await readPluginUiDescriptor(user))?.entry).toBe('/rpc/plugins/user-built/ui/entry.js')
  })
})

describe('serving artifact files', () => {
  const demo = installed('served', { manifest: artifact })
  const outsider = installed('outsider', { bundled: false, manifest: artifact })
  const consented = {
    ...installed('consented', { bundled: false, manifest: artifact }),
    enabled: true,
  }
  const catalog = catalogOf(demo, outsider, consented)

  test('a non-first-party plugin is served only once the user consented to it', () => {
    expect(() => resolvePluginUiFile(catalog, 'outsider', 'entry.js')).toThrow('ships no UI')
    expect(resolvePluginUiFile(catalog, 'consented', 'entry.js')).toBe(
      join(consented.dir, 'dist', 'ui', 'entry.js'),
    )
  })

  test('resolves a file inside the artifact and nothing outside it', () => {
    expect(resolvePluginUiFile(catalog, 'served', 'entry.js')).toBe(
      join(demo.dir, 'dist', 'ui', 'entry.js'),
    )
    for (const escape of ['../../plugin.json', '../ui/../../plugin.json', '/etc/passwd']) {
      expect(() => resolvePluginUiFile(catalog, 'served', escape)).toThrow('inside the UI artifact')
    }
    expect(() => resolvePluginUiFile(catalog, 'outsider', 'entry.js')).toThrow('ships no UI')
    expect(() => resolvePluginUiFile(catalog, 'missing', 'entry.js')).toThrow('ships no UI')
  })

  test('the route answers a module with a JavaScript type; entry revalidates, chunks are immutable', async () => {
    const service = {
      resolveUiFile: async (_userId: string, input: { pluginName: string; file: string }) =>
        resolvePluginUiFile(catalog, input.pluginName, input.file),
    } as unknown as PluginRoutesService
    const app = createPluginRoutes(service)

    const entry = await app.request('/served/ui/entry.js?v=r1')
    expect(entry.status).toBe(200)
    expect(entry.headers.get('Content-Type')).toContain('javascript')
    expect(entry.headers.get('Cache-Control')).toBe('no-cache')
    expect(await entry.text()).toContain('registerUi')

    const chunk = await app.request('/served/ui/chunks/panel-abc.js')
    expect(chunk.headers.get('Cache-Control')).toContain('immutable')

    expect((await app.request('/served/ui/missing.js')).status).toBe(404)
    expect((await app.request('/outsider/ui/entry.js')).status).toBe(404)
    expect((await app.request('/served/ui/..%2F..%2Fplugin.json')).status).toBe(404)
  })
})
