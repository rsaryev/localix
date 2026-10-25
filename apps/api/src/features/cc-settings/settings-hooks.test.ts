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
  expect(only.frontmatterAllowed).toBe(false)
  expect(settingsHooks([user], { projectTrusted: true }).frontmatterAllowed).toBe(true)
})

test('the http hook allowlists merge across settings files', () => {
  const policy = settingsHooks(
    [
      layer('user', { allowedHttpHookUrls: ['https://a.dev/*'] }),
      layer('policy', { allowedHttpHookUrls: ['https://b.dev/*'], httpHookAllowedEnvVars: ['T'] }),
    ],
    { projectTrusted: false },
  ).http
  expect(policy).toEqual({
    allowedUrls: ['https://a.dev/*', 'https://b.dev/*'],
    allowedEnvVars: ['T'],
  })
  expect(settingsHooks([layer('user', {})], { projectTrusted: false }).http).toEqual({})
})

// settings-reference.md, `strictPluginOnlyCustomization.hooks`: hooks of user, project and local
// settings stop running; managed settings' hooks and every plugin's keep running.
test('a managed hooks lock keeps only the organization’s settings hooks and every plugin’s', () => {
  const lock = (value: unknown) => layer('policy', { strictPluginOnlyCustomization: value })
  const layers = (value: unknown) => [
    layer('user', { hooks: hooks('fmt') }),
    layer('project', { hooks: hooks('lint') }),
    layer('local', { hooks: hooks('mine') }),
    layer('policy', { hooks: hooks('audit') }),
    lock(value),
  ]
  const commandsOf = (value: unknown) =>
    settingsHooks(layers(value), { projectTrusted: true }).blocks.map((b) =>
      JSON.stringify(b.raw).includes('audit') ? 'audit' : 'own',
    )
  expect(commandsOf(undefined)).toEqual(['own', 'own', 'own', 'audit'])
  expect(commandsOf(true)).toEqual(['audit'])
  expect(commandsOf(['hooks'])).toEqual(['audit'])
  expect(commandsOf(['skills', 'mcp'])).toEqual(['own', 'own', 'own', 'audit'])
  const locked = settingsHooks(layers(true), { projectTrusted: true })
  expect(locked.pluginAllowed('any@market')).toBe(true)
  expect(locked.frontmatterAllowed).toBe(true)
})

test('a hooks lock a user or project file asks for is not a lock', () => {
  const layers = [
    layer('user', { hooks: hooks('fmt'), strictPluginOnlyCustomization: true }),
    layer('project', { strictPluginOnlyCustomization: ['hooks'] }),
  ]
  expect(settingsHooks(layers, { projectTrusted: true }).blocks).toHaveLength(1)
})
