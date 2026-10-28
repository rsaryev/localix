import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { deleteSkillByName, discoverFilesystemSkills } from './skill-discovery'
import { resolveRunProfile, isToolDirect } from './run-shape'
import { TOOL } from './tool-names'
import { createSkillTool } from './tools/skill'

let root: string
let home: string
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'portable-skills-'))
  home = await fs.mkdtemp(join(tmpdir(), 'portable-home-'))
})
afterEach(async () => {
  await Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(home, { recursive: true, force: true }),
  ])
})

async function writeSkill(base: string, container: string, body: string): Promise<string> {
  const dir = join(base, container, 'skills', 'design-review')
  await fs.mkdir(dir, { recursive: true })
  const path = join(dir, 'SKILL.md')
  await fs.writeFile(
    path,
    `---\nname: design-review\ndescription: Review a rendered UI.\n---\n${body}`,
  )
  return path
}

describe('portable project skills', () => {
  test('native project skills shadow portable ones, and a personal skill shadows both', async () => {
    await writeSkill(root, '.agents', 'portable body')
    await writeSkill(root, '.claude', 'native project body')
    const project = await discoverFilesystemSkills(root, home)
    expect(project.map((skill) => skill.content)).toEqual(['native project body'])
    await writeSkill(home, '.claude', 'personal body')
    const skills = await discoverFilesystemSkills(root, home)
    expect(skills.map((skill) => skill.content)).toEqual(['personal body'])
  })

  test('personal agent homes are not implicitly imported', async () => {
    await writeSkill(home, '.agents', 'foreign personal body')
    expect(await discoverFilesystemSkills(root, home)).toEqual([])
  })

  test('the native manager refuses to delete a portable repository procedure', async () => {
    const path = await writeSkill(root, '.agents', 'portable body')
    expect(await deleteSkillByName(root, 'design-review')).toBe(false)
    expect(await fs.readFile(path, 'utf8')).toContain('portable body')
  })

  test('a portable container cannot escape the project through a symlink', async () => {
    await writeSkill(home, '.agents', 'outside body')
    await fs.mkdir(join(root, '.agents'))
    await fs.symlink(join(home, '.agents', 'skills'), join(root, '.agents', 'skills'))
    expect(await discoverFilesystemSkills(root, home)).toEqual([])
  })

  test('a default child can retrieve a procedure with its reference directory', async () => {
    const path = await writeSkill(root, '.agents', 'Inspect the rendered result.')
    expect(isToolDirect(resolveRunProfile({ sessionKind: 'subagent' }), TOOL.Skill)).toBe(true)
    expect(
      isToolDirect(resolveRunProfile({ sessionKind: 'subagent' }, { tools: [] }), TOOL.Skill),
    ).toBe(false)
    const result = await createSkillTool(root).execute('get-procedure', {
      action: 'get',
      name: 'design-review',
    })
    expect(result.content).toContain('Inspect the rendered result.')
    expect(result.content).toContain(JSON.stringify(join(path, '..')))
  })
})
