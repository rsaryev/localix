/**
 * hooks.md, "Reload skills that a hook installs": with `reloadSkills`, a skill a SessionStart hook
 * wrote reaches this session — the agent is told of it, and the next run's discovery reads it.
 */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { reloadedSkillsNote } from './cc-reload-skills'

const dir = tempDirPerTest('cc-reload-skills-')

test('names the skills that appeared after the run’s discovery, and forgets the cached scope', async () => {
  const skill = join(dir(), '.localix', 'skills', 'deploy', 'SKILL.md')
  mkdirSync(join(skill, '..'), { recursive: true })
  writeFileSync(skill, '---\nname: deploy\ndescription: Ship the build\n---\nShip it.\n')
  let invalidated = 0
  const note = await reloadedSkillsNote({
    cwd: dir(),
    homeDir: join(dir(), 'home'),
    known: ['review'],
    invalidate: () => invalidated++,
  })
  expect(note).toContain('deploy: Ship the build')
  expect(invalidated).toBe(1)
  expect(
    await reloadedSkillsNote({
      cwd: dir(),
      homeDir: join(dir(), 'home'),
      known: ['deploy'],
      invalidate: () => {},
    }),
  ).toBeUndefined()
})
