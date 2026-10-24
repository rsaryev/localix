import { describe, expect, it } from 'bun:test'
import { buildSkillsContext, type SkillListingEntry } from './prompt-skills'
import { skillsMatchingFiles } from './prompt-skill-paths'

// skills.md, frontmatter `paths`: "Claude loads the skill automatically only when working with files
// matching the patterns. Patterns are relative to Claude's current working directory, and files
// outside that directory don't match."
describe('a skill scoped by paths:', () => {
  const cwd = '/work/repo'
  const skills: SkillListingEntry[] = [
    { name: 'ts-style', description: 'TypeScript style', activationPaths: ['src/**/*.ts'] },
    { name: 'py-style', description: 'Python style', activationPaths: ['**/*.py'] },
    { name: 'always', description: 'Unscoped' },
  ]

  it('is offered once the session works with a file its globs match', () => {
    const matching = skillsMatchingFiles(skills, cwd, ['/work/repo/src/app/main.ts'])
    const out = buildSkillsContext(skills, {}, cwd, matching)!
    expect(out).toContain('- /ts-style: TypeScript style')
    expect(out).toContain('- /always: Unscoped')
    expect(out).not.toContain('/py-style')
  })

  it('stays out until then, and a file outside the working directory does not count', () => {
    for (const touched of [[], ['/elsewhere/src/x.ts'], ['/work/repo/README.md']]) {
      const out = buildSkillsContext(skills, {}, cwd, skillsMatchingFiles(skills, cwd, touched))!
      expect(out).not.toContain('/ts-style')
    }
  })
})
