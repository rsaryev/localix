import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { describeClaudeCodePermissions } from './permissions-view'

const scratch = tempDirPerTest('cc-permissions-view-')

let case_ = 0
async function viewOf(tree: Record<string, string>) {
  const root = join(scratch(), `case-${case_++}`)
  writeTree(root, tree)
  const view = await describeClaudeCodePermissions({
    homeDir: join(root, 'home'),
    cwd: join(root, 'project'),
    env: {},
    managed: { dir: join(root, 'managed') },
  })
  return { view, root }
}

const perms = (permissions: object) => JSON.stringify({ permissions })

test('lists every rule of every settings file with the file it came from', async () => {
  const { view, root } = await viewOf({
    'home/.claude/settings.json': perms({ deny: ['Bash(rm *)'], ask: ['Bash(git push *)'] }),
    'project/.claude/settings.local.json': perms({ deny: ['Read(.env)'] }),
  })
  const listed = view.rules.map((r) => `${r.effect} ${r.rule}`)
  expect(listed.sort((a, b) => a.localeCompare(b))).toEqual([
    'ask Bash(git push *)',
    'deny Bash(rm *)',
    'deny Read(.env)',
  ])
  expect(view.rules.find((r) => r.rule === 'Bash(rm *)')?.file).toBe(
    join(root, 'home/.claude/settings.json'),
  )
})

test('names the mode a session starts in and a bypass lock', async () => {
  const { view } = await viewOf({
    'home/.claude/settings.json': perms({
      defaultMode: 'acceptEdits',
      disableBypassPermissionsMode: 'disable',
    }),
  })
  expect(view).toMatchObject({ defaultMode: 'acceptEdits', bypassDisabled: true, rules: [] })
})

test('an empty folder has no rules and no mode', async () => {
  const { view } = await viewOf({})
  expect(view).toEqual({ defaultMode: null, bypassDisabled: false, rules: [] })
})
