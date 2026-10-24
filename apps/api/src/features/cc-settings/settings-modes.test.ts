import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { claudeCodeModes } from './settings-modes'

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
  ).toEqual({ defaultMode: 'bypass', bypassDisabled: true })
})
