import { expect, test } from 'bun:test'

import type { SettingsLayer } from './settings-files'
import { settingsHooks } from './settings-hooks'

const layer = (
  source: SettingsLayer['source'],
  settings: Record<string, unknown>,
): SettingsLayer => ({
  source,
  file: `${source}.json`,
  anchorDir: '/',
  settings,
})
const hooks = (command: string) => ({
  PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command }] }],
})

test("the person's and the organization's hooks load; a project's once trusted", () => {
  const layers = [
    layer('user', { hooks: hooks('fmt') }),
    layer('project', { hooks: hooks('lint') }),
    layer('policy', { hooks: hooks('audit') }),
  ]
  const sources = (trusted: boolean) =>
    settingsHooks(layers, { projectTrusted: trusted }).blocks.map((b) => b.source)
  expect(sources(false)).toEqual(['user', 'user'])
  expect(sources(true)).toEqual(['user', 'project', 'user'])
})

test('disableAllHooks and allowManagedHooksOnly', () => {
  const user = layer('user', { hooks: hooks('fmt') })
  const org = layer('policy', { hooks: hooks('audit') })
  const off = settingsHooks([user, org, layer('policy', { disableAllHooks: true })], {
    projectTrusted: true,
  })
  expect(off.blocks).toEqual([])
  expect(off.pluginAllowed('any')).toBe(false)
  const mine = settingsHooks(
    [{ ...user, settings: { ...user.settings, disableAllHooks: true } }, org],
    {
      projectTrusted: true,
    },
  )
  expect(mine.blocks.map((b) => b.managed)).toEqual([true])
  const only = settingsHooks(
    [
      user,
      layer('policy', { allowManagedHooksOnly: true, enabledPlugins: { 'vetted@corp': true } }),
    ],
    { projectTrusted: true },
  )
  expect(only.blocks).toEqual([])
  expect(only.pluginAllowed('vetted@corp')).toBe(true)
  expect(only.pluginAllowed('vetted')).toBe(true)
  expect(only.pluginAllowed('other')).toBe(false)
})
