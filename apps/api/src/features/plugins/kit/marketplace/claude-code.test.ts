import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { claudeCodeInstallRecords, claudeCodePluginSettings } from './claude-code'

/**
 * What Claude Code's own files say about the plugins a person installed there, read by the kit:
 * `installed_plugins.json` (`parseInstalledPlugins`, read only), and `enabledPlugins` and
 * `pluginConfigs` across the settings files (`enabledPlugin`, `pluginConfig`).
 */

const dir = tempDirPerTest('cc-plugin-settings-')

describe('claudeCodePluginSettings', () => {
  it('the highest file with an entry decides, and managed settings beat every file', async () => {
    const home = join(dir(), 'home')
    const project = join(dir(), 'project')
    writeTree(home, {
      '.claude/settings.json': JSON.stringify({
        enabledPlugins: { 'a@m': true, 'b@m': true, 'c@m': true },
        pluginConfigs: { 'a@m': { options: { level: 2 } } },
      }),
    })
    writeTree(project, {
      '.claude/settings.json': JSON.stringify({ enabledPlugins: { 'b@m': false } }),
    })
    const managed = join(dir(), 'managed')
    writeTree(managed, {
      'managed-settings.json': JSON.stringify({ enabledPlugins: { 'c@m': false } }),
    })
    const settings = await claudeCodePluginSettings({
      homeDir: home,
      cwd: project,
      env: {},
      managed: { dir: managed },
    })
    expect(settings.ids).toEqual(['a@m', 'b@m', 'c@m'])
    expect(settings.enabled('a@m')).toEqual({ on: true, by: 'user' })
    expect(settings.enabled('b@m')).toEqual({ on: false, by: 'project' })
    expect(settings.enabled('c@m')).toEqual({ on: false, by: 'policy' })
    expect(settings.enabled('d@m')).toBeUndefined()
    expect(settings.options('a@m')).toEqual({ level: 2 })
    expect(settings.options('b@m')).toEqual({})
  })
})

describe('claudeCodeInstallRecords', () => {
  it('the records the file holds; a file that cannot be read is no installs', () => {
    const record = { scope: 'user' as const, installPath: '/c/p/1.0.0', version: '1.0.0' }
    expect(
      claudeCodeInstallRecords(JSON.stringify({ version: 2, plugins: { 'p@m': [record] } })),
    ).toEqual({ 'p@m': [record] })
    expect(claudeCodeInstallRecords('not json')).toEqual({})
    expect(claudeCodeInstallRecords(undefined)).toEqual({})
  })
})
