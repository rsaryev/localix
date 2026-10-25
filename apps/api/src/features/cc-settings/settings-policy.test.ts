import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  pluginOnlyLocks,
  readPluginOnlyLocks,
  skillShellExecutionDisabled,
  type PluginOnlySurface,
} from './settings-policy'
import { readSettingsLayers } from './settings-files'

// settings-reference.md: `disableSkillShellExecution` is settable in any file and managed settings
// win; `strictPluginOnlyCustomization` is `Managed` only: `true` locks skills, agents, hooks and
// MCP, an array locks the kinds it names, and a name it does not know is ignored.
const scratch = tempDirPerTest('cc-policy-')
let n = 0

async function input(tree: Record<string, unknown>) {
  const root = join(scratch(), `case-${n++}`)
  writeTree(
    root,
    Object.fromEntries(Object.entries(tree).map(([file, value]) => [file, JSON.stringify(value)])),
  )
  return {
    homeDir: join(root, 'home'),
    cwd: join(root, 'project'),
    env: {},
    managed: { dir: join(root, 'managed') },
  }
}

test('disableSkillShellExecution reads true from any file and is off when unset', async () => {
  expect(await skillShellExecutionDisabled(await input({}))).toBe(false)
  expect(
    await skillShellExecutionDisabled(
      await input({ 'home/.claude/settings.json': { disableSkillShellExecution: true } }),
    ),
  ).toBe(true)
  expect(
    await skillShellExecutionDisabled(
      await input({ 'project/.claude/settings.json': { disableSkillShellExecution: true } }),
    ),
  ).toBe(true)
  expect(
    await skillShellExecutionDisabled(
      await input({ 'home/.claude/settings.json': { disableSkillShellExecution: 'yes' } }),
    ),
  ).toBe(false)
})

test('a managed true cannot be turned off by a user or project file', async () => {
  expect(
    await skillShellExecutionDisabled(
      await input({
        'home/.claude/settings.json': { disableSkillShellExecution: false },
        'project/.claude/settings.local.json': { disableSkillShellExecution: false },
        'managed/managed-settings.json': { disableSkillShellExecution: true },
      }),
    ),
  ).toBe(true)
})

test('strictPluginOnlyCustomization: true locks every kind, an array only the named ones', async () => {
  const all: PluginOnlySurface[] = ['agents', 'hooks', 'mcp', 'skills']
  expect(
    [
      ...(await readPluginOnlyLocks(
        await input({ 'managed/managed-settings.json': { strictPluginOnlyCustomization: true } }),
      )),
    ].sort(),
  ).toEqual(all)
  expect(
    [
      ...(await readPluginOnlyLocks(
        await input({
          'managed/managed-settings.json': {
            strictPluginOnlyCustomization: ['skills', 'hooks', 'commands'],
          },
        }),
      )),
    ].sort(),
  ).toEqual(['hooks', 'skills'])
  expect((await readPluginOnlyLocks(await input({}))).size).toBe(0)
})

test('strictPluginOnlyCustomization from a user, project or local file locks nothing', async () => {
  const locks = await readPluginOnlyLocks(
    await input({
      'home/.claude/settings.json': { strictPluginOnlyCustomization: true },
      'project/.claude/settings.json': { strictPluginOnlyCustomization: ['mcp'] },
      'project/.claude/settings.local.json': { strictPluginOnlyCustomization: true },
    }),
  )
  expect(locks.size).toBe(0)
})

test('the pure reader takes the policy layer of already-read layers', async () => {
  const layers = await readSettingsLayers(
    await input({ 'managed/managed-settings.json': { strictPluginOnlyCustomization: ['agents'] } }),
  )
  expect([...pluginOnlyLocks(layers)]).toEqual(['agents'])
})
