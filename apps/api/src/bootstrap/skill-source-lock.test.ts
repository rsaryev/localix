import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { discoverFilesystemSkills } from '../features/agent-core/skill-discovery'
import { installSkillSourcePolicy } from '../features/agent-core/skill-source-policy'
import { createSkillSourcePolicy } from './skill-source-lock'

// A managed `strictPluginOnlyCustomization` reaches the shared skill discovery through the port the
// composition root installs; a user or project file with the same key does not.
const root = tempDirPerTest('skill-source-lock-')
const skill = (name: string) => `---\nname: ${name}\ndescription: d\n---\nBody.`

function setup(managed: unknown, project: unknown = {}) {
  writeTree(root(), {
    'home/.claude/skills/mine/SKILL.md': skill('mine'),
    'project/.claude/skills/proj/SKILL.md': skill('proj'),
    'project/.claude/settings.json': JSON.stringify(project),
    'managed/managed-settings.json': JSON.stringify(managed),
  })
  installSkillSourcePolicy(createSkillSourcePolicy({ managed: { dir: join(root(), 'managed') } }))
  return discoverFilesystemSkills(join(root(), 'project'), join(root(), 'home'))
}

test('a managed lock on skills leaves no skill from the folders', async () => {
  try {
    expect(await setup({ strictPluginOnlyCustomization: ['skills'] })).toEqual([])
  } finally {
    installSkillSourcePolicy(undefined)
  }
})

test('a lock on another kind, or one a project file sets, leaves them loading', async () => {
  try {
    const names = (s: { name: string }[]) => s.map((x) => x.name).sort()
    expect(names(await setup({ strictPluginOnlyCustomization: ['agents', 'mcp'] }))).toEqual([
      'mine',
      'proj',
    ])
    expect(names(await setup({}, { strictPluginOnlyCustomization: true }))).toEqual([
      'mine',
      'proj',
    ])
  } finally {
    installSkillSourcePolicy(undefined)
  }
})
