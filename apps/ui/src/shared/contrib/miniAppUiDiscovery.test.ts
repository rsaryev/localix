import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import type { MiniAppRecord } from '@/shared/api/contracts'
import { miniAppSources, miniAppUiArtifacts } from './miniAppUiDiscovery'

const record = (name: string, enabled: boolean, ui?: MiniAppRecord['ui']) =>
  ({ name, enabled, ...(ui ? { ui } : {}) }) as MiniAppRecord

describe('plugin UI wiring', () => {
  test('the runtime is handed exactly the enabled plugins that ship an artifact', () => {
    const ui = { entry: '/rpc/mini-apps/a/ui/entry.js', styles: [], revision: 'r1' }
    expect(
      miniAppUiArtifacts([
        record('a', true, ui),
        record('disabled', false, ui),
        record('backend-only', true),
      ]),
    ).toEqual([{ name: 'a', ...ui }])
  })

  // Attribution matches stack frames against these bases, so each must be the directory the entry
  // is imported from — covering its chunks — and must not carry the revision query they lack.
  test('names each installed plugin and the directory its loaded UI is served from', () => {
    const ui = { entry: '/rpc/mini-apps/a/ui/entry.js', styles: [], revision: 'r1' }
    const { sources, names } = miniAppSources([
      { ...record('a', true, ui), displayName: 'Alpha' },
      record('backend-only', true),
    ])
    expect(sources).toEqual([
      { pluginName: 'a', base: new URL('/rpc/mini-apps/a/ui/', sources[0]!.base).href },
    ])
    expect(sources[0]!.base).toEndWith('/rpc/mini-apps/a/ui/')
    expect([...names]).toEqual([
      ['a', 'Alpha'],
      ['backend-only', 'backend-only'],
    ])
  })

  // The defect this module used to carry: it owned a glob over the plugins tree and answered any
  // hot update with a page reload. A plugin is loaded by URL now; nothing here may reload.
  test('never reloads the page and never compiles plugins into the host', () => {
    const source = readFileSync(new URL('./miniAppUiDiscovery.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\breload\(|import\.meta\.hot|import\.meta\.glob|plugins\//u)
  })
})
