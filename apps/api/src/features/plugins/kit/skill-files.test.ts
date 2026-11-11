import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { readSkillFolder, skillFileIssues, skillFilePath, skillNameRefusal } from './skill-files'

const dir = tempDirPerTest('kit-skill-files')

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

describe('skillFilePath', () => {
  test('a new skill is <folder>/skills/<name>/SKILL.md', () => {
    expect(skillFilePath('/h/.claude', 'deploy')).toBe('/h/.claude/skills/deploy/SKILL.md')
  })
})

describe('skillNameRefusal', () => {
  test('a plain name is allowed; a name Claude Code refuses is refused with its message', () => {
    expect(skillNameRefusal('user', 'deploy')).toBeUndefined()
    expect(skillNameRefusal('project', 'de​ploy')).toBeString()
  })
})

describe('skillFileIssues', () => {
  test('a bad frontmatter value is a warning of the file', () => {
    const issues = skillFileIssues(
      '/p/SKILL.md',
      '---\nname: x\nuser-invocable: maybe\n---\nbody\n',
      'project',
    )
    expect(issues.some((issue) => issue.severity === 'warning')).toBe(true)
    expect(skillFileIssues('/p/SKILL.md', '---\nname: x\n---\nbody\n', 'project')).toEqual([])
  })
})

describe('readSkillFolder', () => {
  test('lists the skill folders of a container with their name, description and paths', async () => {
    const root = join(dir(), 'archive')
    write(join(root, 'tidy', 'SKILL.md'), '---\nname: tidy\ndescription: Tidy up\n---\nGo\n')
    write(join(root, 'notes', 'README.md'), 'not a skill')
    const skills = await readSkillFolder(root, 'user')
    expect(skills).toEqual([
      {
        name: 'tidy',
        description: 'Tidy up',
        dir: join(root, 'tidy'),
        path: join(root, 'tidy', 'SKILL.md'),
      },
    ])
  })

  test('a folder that does not exist has no skills', async () => {
    expect(await readSkillFolder(join(dir(), 'none'), 'project')).toEqual([])
  })
})
