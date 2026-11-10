import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { deleteSkillByName } from './skill-discovery'
import { resolveRunProfile, isToolDirect } from './run-shape'
import { TOOL } from './tool-names'

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
  test('the native manager refuses to delete a portable repository procedure', async () => {
    const path = await writeSkill(root, '.agents', 'portable body')
    expect(await deleteSkillByName(root, 'design-review')).toBe(false)
    expect(await fs.readFile(path, 'utf8')).toContain('portable body')
  })

  test('a default child holds the Skill tool to retrieve a procedure with', () => {
    expect(isToolDirect(resolveRunProfile({ sessionKind: 'subagent' }), TOOL.Skill)).toBe(true)
    expect(
      isToolDirect(resolveRunProfile({ sessionKind: 'subagent' }, { tools: [] }), TOOL.Skill),
    ).toBe(false)
  })
})
