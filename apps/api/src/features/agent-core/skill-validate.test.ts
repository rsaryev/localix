import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateSkillFile } from './skill-validate'

let root: string

async function writeSkill(dirName: string, contents: string): Promise<string> {
  const dir = join(root, dirName)
  await fs.mkdir(dir, { recursive: true })
  const path = join(dir, 'SKILL.md')
  await fs.writeFile(path, contents, 'utf8')
  return path
}

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'skill-validate-'))
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('validateSkillFile', () => {
  it('passes a well-formed skill with no findings', async () => {
    const path = await writeSkill(
      'deploy',
      '---\nname: deploy\ndescription: Deploy the app\n---\n\nRun the deploy script.',
    )
    const v = await validateSkillFile(path)
    expect(v.errors).toHaveLength(0)
    expect(v.warnings).toHaveLength(0)
  })

  it('warns on a missing frontmatter name (directory fallback)', async () => {
    const path = await writeSkill(
      'nameless',
      '---\ndescription: Something useful\n---\n\nBody text here.',
    )
    const v = await validateSkillFile(path)
    expect(v.errors).toHaveLength(0)
    expect(v.warnings.some((w) => w.includes('no frontmatter "name"'))).toBe(true)
  })

  it('warns on contradictory allowed/disallowed tools', async () => {
    const path = await writeSkill(
      'contradict',
      '---\nname: contradict\ndescription: d\nallowed-tools: Bash Write\ndisallowed-tools: Write\n---\n\nBody.',
    )
    const v = await validateSkillFile(path)
    expect(v.warnings.some((w) => w.includes('both "allowed-tools" and "disallowed-tools"'))).toBe(
      true,
    )
  })

  it('errors on an unreadable file', async () => {
    const v = await validateSkillFile(join(root, 'does-not-exist', 'SKILL.md'))
    expect(v.errors.some((e) => e.includes('Cannot read skill file'))).toBe(true)
  })
})
