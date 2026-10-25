import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { createSkillShellPolicy } from './skill-shell-policy'

// skills.md: `disableSkillShellExecution` leaves bundled and managed skills alone and applies to
// the person's, a project's and a plugin's. Localix's built-in plugins are its bundled skills.
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
    builtinRoot: () => null,
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
    builtinRoot: () => null,
  })
  expect(await policy({ workingDir: join(scratch(), 'p'), skillPath: '/x/SKILL.md' })).toBe(true)
})

test('a skill of a built-in plugin keeps running its commands', async () => {
  writeTree(scratch(), {
    'managed/managed-settings.json': JSON.stringify({ disableSkillShellExecution: true }),
    'builtin/tool/skills/a/SKILL.md': 'x',
  })
  const policy = createSkillShellPolicy({
    homeDir: join(scratch(), 'home'),
    managed: { dir: join(scratch(), 'managed') },
    builtinRoot: () => join(scratch(), 'builtin'),
  })
  const inside = join(scratch(), 'builtin', 'tool', 'skills', 'a', 'SKILL.md')
  expect(await policy({ workingDir: scratch(), skillPath: inside })).toBe(false)
  expect(
    await policy({ workingDir: scratch(), skillPath: join(scratch(), 'other', 'SKILL.md') }),
  ).toBe(true)
})
