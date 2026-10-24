import { describe, expect, it } from 'bun:test'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { buildSkillsContext, type SkillListingEntry } from './prompt-skills'
import { skillsMatchingProjectFiles } from './prompt-skill-paths'

// skills.md, frontmatter `paths`: "Glob patterns that limit when this skill is activated … Claude
// loads the skill automatically only when working with files matching the patterns. Patterns are
// relative to Claude's current working directory". The patterns name FILES, so a skill scoped to
// `src/**/*.ts` must be offered in a project that has TypeScript under `src/`.
describe('a skill scoped by paths:', () => {
  const dir = tempDirPerTest('skill-paths-')

  const skills: SkillListingEntry[] = [
    { name: 'ts-style', description: 'TypeScript style', activationPaths: ['src/**/*.ts'] },
    { name: 'py-style', description: 'Python style', activationPaths: ['**/*.py'] },
    { name: 'always', description: 'Unscoped' },
  ]

  it('is offered when the working directory has a file its globs match', async () => {
    writeTree(dir(), { 'src/app/main.ts': 'export {}', 'README.md': '# x' })
    const matching = await skillsMatchingProjectFiles(skills, dir())
    const out = buildSkillsContext(skills, {}, dir(), matching)!
    expect(out).toContain('- /ts-style: TypeScript style')
    expect(out).toContain('- /always: Unscoped')
    expect(out).not.toContain('/py-style')
  })

  it('stays out of a project with no matching file', async () => {
    writeTree(dir(), { 'lib/main.rb': 'puts 1' })
    const matching = await skillsMatchingProjectFiles(skills, dir())
    const out = buildSkillsContext(skills, {}, dir(), matching)!
    expect(out).not.toContain('/ts-style')
    expect(out).not.toContain('/py-style')
  })
})
