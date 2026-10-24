import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { discoverFilesystemSkills } from './skill-discovery'

// skills.md, "Choose where skills load": personal `~/.claude/skills/<name>/SKILL.md`, project
// `.claude/skills/<name>/SKILL.md` "in the directory where you start it and in every parent
// directory up to the repository root", and the older command files in `.claude/commands/`.
describe('skills where Claude Code keeps them', () => {
  const base = tempDirPerTest('cc-skill-locations-')
  const write = async (path: string, text: string) => {
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, text)
  }
  const skill = (name: string, description: string) =>
    `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${description}.`
  const setup = async () => {
    const home = join(base(), 'home')
    const repo = join(base(), 'repo')
    await fs.mkdir(join(repo, '.git'), { recursive: true })
    await fs.mkdir(home, { recursive: true })
    return { home, repo }
  }

  test('personal and project .claude/skills load, the repository root’s from a subfolder', async () => {
    const { home, repo } = await setup()
    await write(join(home, '.claude', 'skills', 'mine', 'SKILL.md'), skill('mine', 'personal'))
    await write(join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), skill('deploy', 'root'))
    const pkg = join(repo, 'packages', 'frontend')
    await fs.mkdir(pkg, { recursive: true })
    const skills = await discoverFilesystemSkills(pkg, home)
    expect(skills.map((s) => [s.name, s.scope])).toEqual([
      ['deploy', 'project'],
      ['mine', 'global'],
    ])
  })

  // "Enterprise over personal, and personal over project. With `deploy` in both `~/.claude/skills/`
  // and the project's `.claude/skills/`, `/deploy` runs the personal one".
  test('a personal skill wins over a project skill of the same name', async () => {
    const { home, repo } = await setup()
    await write(join(home, '.claude', 'skills', 'deploy', 'SKILL.md'), skill('deploy', 'personal'))
    await write(join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), skill('deploy', 'project'))
    const skills = await discoverFilesystemSkills(repo, home)
    expect(skills.map((s) => s.description)).toEqual(['personal'])
  })

  // "File under `.claude/commands/` | File name without extension"; "File in a subdirectory of
  // `.claude/commands/` | Subdirectory path … with each `/` replaced by `:`"; commands accept "the
  // same frontmatter except `name` and `paths`"; "A skill and a file in `.claude/commands/` | The skill".
  test('.claude/commands files are skills named by their path; a skill beats a command', async () => {
    const { home, repo } = await setup()
    const cmds = join(repo, '.claude', 'commands')
    await write(
      join(cmds, 'deploy.md'),
      '---\ndescription: Deploy the app\nargument-hint: "[env]"\ndisable-model-invocation: true\n---\nDeploy $ARGUMENTS.',
    )
    await write(join(cmds, 'git', 'commit.md'), '---\nname: ignored\npaths: x/**\n---\nCommit it.')
    await write(join(cmds, '.archive', 'old.md'), 'Old.')
    await write(join(cmds, 'shared.md'), '---\ndescription: COMMAND\n---\nCommand body.')
    await write(join(repo, '.claude', 'skills', 'shared', 'SKILL.md'), skill('shared', 'SKILL'))
    await write(join(home, '.claude', 'commands', 'note.md'), 'Take a note.')
    const skills = await discoverFilesystemSkills(repo, home)
    const byName = new Map(skills.map((s) => [s.name, s]))
    expect([...byName.keys()].sort()).toEqual(['deploy', 'git:commit', 'note', 'shared'])
    expect(byName.get('deploy')).toMatchObject({
      description: 'Deploy the app',
      argumentHint: '[env]',
      disableModelInvocation: true,
      path: join(cmds, 'deploy.md'),
    })
    expect(byName.get('git:commit')?.activationPaths).toBeUndefined()
    expect(byName.get('git:commit')?.description).toBe('Commit it.')
    expect(byName.get('shared')?.description).toBe('SKILL')
    expect(byName.get('note')?.scope).toBe('global')
  })
})
