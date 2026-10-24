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
    'managed/managed-settings.json': JSON.stringify({ permissions: { deny: ['WebFetch'] } }),
  })
  const settings = createSettingsApi({
    cwd: () => join(root, 'project'),
    homeDir: join(root, 'home'),
    env: {},
    managed: { dir: join(root, 'managed') },
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

test('settings follow CLAUDE_CONFIG_DIR, managed drop-ins and whole-value keys', async () => {
  const root = scratch()
  writeTree(root, {
    'work/settings.json': JSON.stringify({ fallbackModel: ['opus', 'sonnet'], model: 'opus' }),
    'home/.claude/settings.json': JSON.stringify({ model: 'haiku' }),
    'project/.claude/settings.json': JSON.stringify({ fallbackModel: ['haiku'] }),
    'managed/managed-settings.json': JSON.stringify({ permissions: { deny: ['WebFetch'] } }),
    'managed/managed-settings.d/10-more.json': JSON.stringify({ permissions: { deny: ['Bash'] } }),
    'managed/managed-settings.d/.hidden.json': JSON.stringify({ permissions: { deny: ['Read'] } }),
  })
  const settings = createSettingsApi({
    cwd: () => join(root, 'project'),
    homeDir: join(root, 'home'),
    env: { CLAUDE_CONFIG_DIR: join(root, 'work') },
    managed: { dir: join(root, 'managed') },
  })
  expect(await settings.read()).toEqual({
    model: 'opus',
    fallbackModel: ['haiku'],
    permissions: { deny: ['WebFetch', 'Bash'] },
  })
  expect(await settings.read({ source: 'user' })).toEqual({
    fallbackModel: ['opus', 'sonnet'],
    model: 'opus',
  })
})
