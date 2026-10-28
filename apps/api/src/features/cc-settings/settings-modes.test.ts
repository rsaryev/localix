import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { claudeCodeMainAgent, claudeCodeModes } from './settings-modes'

const scratch = tempDirPerTest('cc-modes-')

let case_ = 0
async function modesOf(tree: Record<string, string>) {
  const root = join(scratch(), `case-${case_++}`)
  writeTree(root, tree)
  return claudeCodeModes({
    homeDir: join(root, 'home'),
    cwd: join(root, 'project'),
    env: {},
    managed: { dir: join(root, 'managed') },
  })
}

async function mainAgentOf(tree: Record<string, string>) {
  const root = join(scratch(), `case-${case_++}`)
  writeTree(root, tree)
  return claudeCodeMainAgent({
    homeDir: join(root, 'home'),
    cwd: join(root, 'project'),
    env: {},
    managed: { dir: join(root, 'managed') },
  })
}

const perms = (permissions: object) => JSON.stringify({ permissions })

test('defaultMode names the starting mode; the project file wins over the user file', async () => {
  expect(
    await modesOf({
      'home/.claude/settings.json': perms({ defaultMode: 'bypassPermissions' }),
      'project/.claude/settings.json': perms({ defaultMode: 'plan' }),
    }),
  ).toEqual({ defaultMode: 'plan', bypassDisabled: false })
  expect(await modesOf({ 'home/.claude/settings.json': perms({ defaultMode: 'manual' }) })).toEqual(
    { defaultMode: 'default', bypassDisabled: false },
  )
  // No Localix mode means the same as acceptEdits: the conversation starts in Default.
  expect(
    await modesOf({ 'home/.claude/settings.json': perms({ defaultMode: 'acceptEdits' }) }),
  ).toEqual({ bypassDisabled: false })
})

test('disableBypassPermissionsMode holds from any file', async () => {
  expect(
    await modesOf({
      'home/.claude/settings.json': perms({ disableBypassPermissionsMode: 'disable' }),
      'project/.claude/settings.local.json': perms({ defaultMode: 'bypassPermissions' }),
    }),
  ).toEqual({ bypassDisabled: true })
})

// permission-modes.md: `auto` and `bypassPermissions` take no effect from project or local files,
// and the session then starts in the built-in default, not in the user file's mode.
test('bypassPermissions and auto from a project or local file are ignored', async () => {
  for (const file of ['project/.claude/settings.json', 'project/.claude/settings.local.json'])
    for (const mode of ['bypassPermissions', 'auto'])
      expect(
        await modesOf({
          'home/.claude/settings.json': perms({ defaultMode: 'plan' }),
          [file]: perms({ defaultMode: mode }),
        }),
      ).toEqual({ bypassDisabled: false })
  // The user file may set it, and the project's other values still apply.
  expect(
    await modesOf({ 'home/.claude/settings.json': perms({ defaultMode: 'bypassPermissions' }) }),
  ).toEqual({ defaultMode: 'bypass', bypassDisabled: false })
  expect(
    await modesOf({
      'home/.claude/settings.json': perms({ defaultMode: 'bypassPermissions' }),
      'project/.claude/settings.json': perms({ defaultMode: 'plan' }),
    }),
  ).toEqual({ defaultMode: 'plan', bypassDisabled: false })
})

test('the `agent` setting is the main agent: the higher file wins, a blank one is none', async () => {
  const agent = (name: unknown) => JSON.stringify({ agent: name })
  expect(
    await mainAgentOf({
      'home/.claude/settings.json': agent('reviewer'),
      'project/.claude/settings.json': agent('auditor'),
    }),
  ).toBe('auditor')
  expect(await mainAgentOf({ 'home/.claude/settings.json': agent('reviewer') })).toBe('reviewer')
  expect(await mainAgentOf({ 'home/.claude/settings.json': agent('  ') })).toBeUndefined()
  expect(await mainAgentOf({ 'home/.claude/settings.json': agent(3) })).toBeUndefined()
  expect(await mainAgentOf({})).toBeUndefined()
})
