import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { createSkillShellPolicy } from './skill-shell-policy'

// skills.md: `disableSkillShellExecution` applies to the person's, a project's and a plugin's skills.
// Localix ships no plugin, so it has no bundled skills for the setting to leave alone.
const scratch = tempDirPerTest('skill-shell-port-')

test('is on for the session folder the settings name, and off beside them', async () => {
  writeTree(scratch(), {
    'home/.claude/settings.json': JSON.stringify({}),
    'on/.claude/settings.json': JSON.stringify({ disableSkillShellExecution: true }),
    'off/.keep': '',
  })
  const policy = createSkillShellPolicy({
    homeDir: join(scratch(), 'home'),
    managed: { dir: join(scratch(), 'managed') },
  })
  expect(await policy({ workingDir: join(scratch(), 'on') })).toBe(true)
  expect(await policy({ workingDir: join(scratch(), 'off') })).toBe(false)
})

test('a managed policy applies in every folder', async () => {
  writeTree(scratch(), {
    'managed/managed-settings.json': JSON.stringify({ disableSkillShellExecution: true }),
    'p/.keep': '',
  })
  const policy = createSkillShellPolicy({
    homeDir: join(scratch(), 'home'),
    managed: { dir: join(scratch(), 'managed') },
  })
  expect(await policy({ workingDir: join(scratch(), 'p'), skillPath: '/x/SKILL.md' })).toBe(true)
})
