import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { discoverFilesystemSkills } from './skill-discovery'
import { installSkillSourcePolicy } from './skill-source-policy'

// settings-reference.md, `strictPluginOnlyCustomization.skills`: skills and custom commands of the
// person's and a project's folders do not load; `.hooks`: a skill's frontmatter hooks stop running
// and it loses its `allowed-tools` pre-approval, unless it runs through `context: fork`.
const root = tempDirPerTest('skill-source-policy-')
afterEach(() => installSkillSourcePolicy(undefined))

const skill = (name: string, extra = '') =>
  `---\nname: ${name}\ndescription: does ${name}\n${extra}---\nBody of ${name}.`
const HOOKS =
  'hooks:\n  PreToolUse:\n    - hooks:\n        - type: command\n          command: echo hi\n'

function tree() {
  writeTree(root(), {
    'home/.claude/skills/mine/SKILL.md': skill('mine'),
    'home/.claude/skills/theirs/SKILL.md': skill('theirs'),
    'project/.claude/skills/proj/SKILL.md': skill('proj'),
    'project/.claude/commands/cmd.md': '---\ndescription: a command\n---\nDo it.',
    'project/.claude/skills/hooked/SKILL.md': skill('hooked', `allowed-tools: Bash(ls)\n${HOOKS}`),
    'project/.claude/skills/forked/SKILL.md': skill(
      'forked',
      `allowed-tools: Bash(ls)\ncontext: fork\n${HOOKS}`,
    ),
    'project/.claude/skills/plain/SKILL.md': skill('plain', 'allowed-tools: Bash(ls)\n'),
  })
  return { home: join(root(), 'home'), cwd: join(root(), 'project') }
}

describe('the lock on skill folders', () => {
  test('no policy installed: every folder loads', async () => {
    const { home, cwd } = tree()
    const names = (await discoverFilesystemSkills(cwd, home)).map((s) => s.name)
    expect(names).toEqual(
      expect.arrayContaining(['mine', 'theirs', 'proj', 'cmd', 'hooked', 'forked', 'plain']),
    )
  })

  test('skills locked: nothing of the person’s or the project’s loads, for every caller', async () => {
    const { home, cwd } = tree()
    const seen: unknown[] = []
    installSkillSourcePolicy(
      async (query) => (seen.push(query), { blockFolders: true, stripHooks: false }),
    )
    expect(await discoverFilesystemSkills(cwd, home)).toEqual([])
    expect(seen).toEqual([{ workingDir: cwd, homeDir: home }])
  })

  test('hooks locked: a skill loses its hooks and pre-approval, a forked one keeps the pre-approval', async () => {
    const { home, cwd } = tree()
    installSkillSourcePolicy(async () => ({ blockFolders: false, stripHooks: true }))
    const byName = new Map((await discoverFilesystemSkills(cwd, home)).map((s) => [s.name, s]))
    expect(byName.get('hooked')?.hooks).toBeUndefined()
    expect(byName.get('hooked')?.allowedTools).toBeUndefined()
    expect(byName.get('forked')?.hooks).toBeUndefined()
    expect(byName.get('forked')?.allowedTools).toEqual(['Bash(ls)'])
    // A skill that declares no hooks keeps its pre-approval.
    expect(byName.get('plain')?.allowedTools).toEqual(['Bash(ls)'])
  })
})
