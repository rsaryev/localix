import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createSettingsApi } from './settings-api'

const scratch = tempDirPerTest('mods-settings', {})

test('settings read one source as loaded, or all merged by precedence', async () => {
  const root = scratch()
  writeTree(root, {
    'home/.claude/settings.json': JSON.stringify({
      model: 'sonnet',
      permissions: { allow: ['Read'] },
      env: { A: '1' },
    }),
    'project/.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }),
    'project/.claude/settings.local.json': JSON.stringify({ model: 'opus' }),
    'managed.json': JSON.stringify({ permissions: { deny: ['WebFetch'] } }),
  })
  const settings = createSettingsApi({
    cwd: () => join(root, 'project'),
    homeDir: join(root, 'home'),
    managedPath: join(root, 'managed.json'),
  })
  expect(await settings.read({ source: 'policy' })).toEqual({
    permissions: { deny: ['WebFetch'] },
  })
  expect(await settings.read({ source: 'flag' })).toEqual({})
  expect(await settings.read()).toEqual({
    model: 'opus',
    permissions: { allow: ['Read', 'Bash(ls)'], deny: ['WebFetch'] },
    env: { A: '1' },
  })
  await expect(settings.read({ source: 'nope' })).rejects.toThrow('no source named nope')
})
