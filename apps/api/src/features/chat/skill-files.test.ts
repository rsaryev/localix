import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { setSkillAuthoredRecorder } from '../agent-core/skill-usage-recorder'
import { parseMarkdownFrontmatter } from '../agent-core/frontmatter-yaml'
import { removeSkill, renderSkillFile, writeSkill } from './skill-files'

/**
 * The one place skills are written, for the Store and for the agent's `Skill` tool. A draft carries
 * a name, a description and a body and nothing else, so an edit merges into the file: rebuilding
 * the frontmatter from the draft used to delete every other key the SKILL.md carried.
 */
const dir = tempDirPerTest('skill-files')
const project = () => ({ folder: join(dir(), 'repo', '.claude'), kind: 'project' as const })
const skillFile = (name: string) => join(dir(), 'repo', '.claude', 'skills', name, 'SKILL.md')

async function seed(name: string, text: string) {
  await fs.mkdir(join(skillFile(name), '..'), { recursive: true })
  await fs.writeFile(skillFile(name), text)
}

describe('writeSkill', () => {
  test('an edit of the description keeps every other frontmatter key, known or not', async () => {
    await seed(
      'deploy',
      [
        '---',
        'name: deploy',
        'description: old description',
        'argument-hint: "[env]"',
        'user-invocable: false',
        'allowed-tools: Bash(git *) Read',
        'license: Apache-2.0',
        'metadata:',
        '  owner: infra',
        '---',
        '',
        'Deploy to $1.',
        '',
      ].join('\n'),
    )
    await writeSkill(project(), {
      name: 'deploy',
      description: 'new description',
      content: 'Deploy to $1.',
    })
    const raw = await fs.readFile(skillFile('deploy'), 'utf8')
    expect(raw).toContain('description: new description')
    expect(raw).not.toContain('old description')
    for (const kept of [
      'argument-hint: "[env]"',
      'user-invocable: false',
      'allowed-tools: Bash(git *) Read',
      'license: Apache-2.0',
      '  owner: infra',
    ])
      expect(raw).toContain(kept)
  })

  test('a new skill is <folder>/skills/<name>/SKILL.md with a one-line description', async () => {
    const file = await writeSkill(project(), {
      name: 'fresh',
      description: 'a\tb\nc',
      content: '  body  ',
    })
    expect(file).toBe(skillFile('fresh'))
    expect(await fs.readFile(file, 'utf8')).toBe(
      '---\nname: fresh\ndescription: a b c\n---\n\nbody\n',
    )
  })

  test('a name that is not one plain folder, or that Claude Code refuses, is not written', async () => {
    for (const name of ['../out', 'a/b', '', '.hidden'])
      await expect(
        writeSkill(project(), { name, description: 'd', content: 'b' }),
      ).rejects.toThrow()
  })

  test('a skills folder linked out of the project is not written through', async () => {
    const outside = join(dir(), 'outside')
    await fs.mkdir(outside, { recursive: true })
    await fs.mkdir(join(dir(), 'repo', '.claude'), { recursive: true })
    await fs.symlink(outside, join(dir(), 'repo', '.claude', 'skills'))
    await expect(
      writeSkill(project(), { name: 'x', description: 'd', content: 'b' }),
    ).rejects.toThrow(/escaping symlink/)
    expect(await fs.readdir(outside)).toEqual([])
  })

  test('only a new skill is recorded as made in Localix, not an edit of one that was there', async () => {
    const made: string[] = []
    setSkillAuthoredRecorder((name, scope, projectId) => {
      made.push(`${scope}:${projectId}:${name}`)
    })
    try {
      const draft = { name: 'a', description: 'd', content: 'b' }
      await writeSkill(project(), draft, { projectId: 'p1' })
      await writeSkill(project(), { ...draft, description: 'e' }, { projectId: 'p1' })
      await seed('b', '---\nname: b\ndescription: x\n---\nb\n')
      await writeSkill(project(), { ...draft, name: 'b' }, { projectId: 'p1' })
      expect(made).toEqual(['project:p1:a'])
    } finally {
      setSkillAuthoredRecorder(null)
    }
  })
})

describe('renderSkillFile', () => {
  test('sets owned keys and keeps comments, order and unknown keys', () => {
    const existing = [
      '---',
      '# authored by hand',
      'name: old',
      'license: MIT # keep this note',
      'metadata:',
      '  author: jane',
      'description: old text',
      '---',
      'old body',
    ].join('\n')
    const out = renderSkillFile(existing, {
      name: 'new',
      description: 'Use when: deploying',
      content: 'new body',
    })
    expect(out).toBe(
      [
        '---',
        '# authored by hand',
        'name: new',
        'license: MIT # keep this note',
        'metadata:',
        '  author: jane',
        // The line writer emitted this unquoted — invalid YAML every real parser rejects.
        'description: "Use when: deploying"',
        '---',
        '',
        'new body',
        '',
      ].join('\n'),
    )
    expect(parseMarkdownFrontmatter(out).fields.description).toBe('Use when: deploying')
  })

  test('writes a new file with name and description first', () => {
    expect(renderSkillFile('', { name: 'n', description: 'd\nmore', content: ' b ' })).toBe(
      '---\nname: n\ndescription: d more\n---\n\nb\n',
    )
  })
})

describe('removeSkill', () => {
  test("removes the folder's skill by name; a missing or unsafe name removes nothing", async () => {
    await seed('gone', '---\nname: gone\ndescription: d\n---\nb\n')
    expect(await removeSkill(project().folder, 'gone')).toBe(true)
    expect(await fs.exists(join(skillFile('gone'), '..'))).toBe(false)
    expect(await removeSkill(project().folder, 'gone')).toBe(false)
    expect(await removeSkill(project().folder, '..')).toBe(false)
  })
})
