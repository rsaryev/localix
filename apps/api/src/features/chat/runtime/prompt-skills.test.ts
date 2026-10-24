import { describe, it, expect } from 'bun:test'
import { buildSkillsContext, type SkillListingEntry } from './prompt-skills'

const cwd = '/work/project'

describe('buildSkillsContext', () => {
  // skills.md: a plugin skill is available "as `/plugin-name:skill-name`".
  it('lists a plugin skill by its namespaced name, one line per plugin', () => {
    const out = buildSkillsContext(
      [
        { name: 'lookup', pluginName: 'nsa', description: 'A lookup' },
        { name: 'lookup', pluginName: 'nsb', description: 'B lookup' },
        { name: 'nsc:prefixed', pluginName: 'nsc', description: 'Already prefixed' },
      ],
      {},
      cwd,
    )
    expect(out).toContain('- /nsa:lookup: A lookup')
    expect(out).toContain('- /nsb:lookup: B lookup')
    expect(out).toContain('- /nsc:prefixed: Already prefixed')
    expect(out).not.toContain('- /lookup')
  })

  it('lists ordinary skills and omits disable-model-invocation ones', () => {
    const skills: SkillListingEntry[] = [
      { name: 'deploy', description: 'Deploy the app' },
      { name: 'secret', description: 'Internal', disableModelInvocation: true },
    ]
    const out = buildSkillsContext(skills, {}, cwd)
    expect(out).toContain('- /deploy: Deploy the app')
    expect(out).not.toContain('/secret')
  })

  it('hides hide-from-slash-command-tool skills from the model listing', () => {
    const skills: SkillListingEntry[] = [
      { name: 'visible', description: 'Shown' },
      { name: 'quiet', description: 'Hidden helper', hideFromModel: true },
    ]
    const out = buildSkillsContext(skills, {}, cwd)
    expect(out).toContain('/visible')
    // A skill its own frontmatter hides stays hidden. There used to be an override that
    // re-surfaced it, along with two that narrowed how a visible skill was shown; none was
    // reachable from any surface — they could only be set by hand-editing a settings document
    // that no longer exists — so visibility is now the single verdict the resolver gives.
    expect(out).not.toContain('/quiet')
  })

  it('off removes a skill from the model roster', () => {
    const out = buildSkillsContext(
      [
        { name: 'enabled', description: 'Shown' },
        { name: 'disabled', description: 'Hidden' },
      ],
      { disabled: 'off' },
      cwd,
    )
    expect(out).toContain('/enabled')
    expect(out).not.toContain('/disabled')
  })

  // `paths:` is free text from a skill author's frontmatter, and real directories carry
  // `.`, `+`, `(`. The hand-rolled compiler translated only `*`/`**` and passed the rest
  // into the regex verbatim.
  it('a literal dot in paths: does not match any character', () => {
    const skills: SkillListingEntry[] = [
      {
        name: 'scoped',
        description: 'Scoped',
        activationPaths: ['apps/my.app'],
      },
    ]
    expect(buildSkillsContext(skills, {}, '/work/apps/my.app/src')).toContain('/scoped')
    // THE BUG: the `.` matched any char, so a sibling directory activated the skill.
    expect(buildSkillsContext(skills, {}, '/work/apps/myXapp/src')).toBeUndefined()
  })

  it('a paths: pattern with regex metacharacters still matches its own directory', () => {
    // THE OTHER HALF: `(` threw a SyntaxError, the catch turned it into "no match", and
    // the skill vanished from the listing in the very repo it was scoped to — silently.
    const skills: SkillListingEntry[] = [
      { name: 'legacy', description: 'Legacy', activationPaths: ['src/(old)'] },
    ]
    expect(buildSkillsContext(skills, {}, '/work/src/(old)')).toContain('/legacy')
  })

  it('* and ** still work — the reverse direction', () => {
    // Escaping must not swallow the glob wildcards themselves, or every scoped skill
    // stops matching and the listing silently empties.
    const star: SkillListingEntry[] = [
      { name: 'one', description: 'One', activationPaths: ['apps/*'] },
    ]
    expect(buildSkillsContext(star, {}, '/work/apps/api')).toContain('/one')
    expect(buildSkillsContext(star, {}, '/work/other/api')).toBeUndefined()

    const deep: SkillListingEntry[] = [
      { name: 'two', description: 'Two', activationPaths: ['apps/**/src'] },
    ]
    expect(buildSkillsContext(deep, {}, '/work/apps/a/b/src')).toContain('/two')
  })

  // skills.md: "the combined `description` and `when_to_use` text is truncated at 1,536
  // characters in the skill listing". A Claude Code skill puts its trigger phrases after the
  // first sentence ("Use when the user asks to pair, approve someone…"), so a 120-character cut
  // kept the summary and dropped exactly the words the model matches a request against.
  it('keeps a description up to 1,536 characters, the trigger phrases included', () => {
    const description =
      'Manage Discord channel access — approve pairings, edit allowlists, set DM/group policy. ' +
      "Use when the user asks to pair, approve someone, check who's allowed, or change policy."
    const out = buildSkillsContext([{ name: 'access', description }], {}, cwd)!
    expect(out).toBe(`- /access: ${description}`)
    const long = buildSkillsContext([{ name: 'long', description: 'y'.repeat(2_000) }], {}, cwd)!
    expect(long).toBe(`- /long: ${'y'.repeat(1_536)}`)
  })

  it('drops descriptions before names when the full roster exceeds the budget', () => {
    // Fifty plugin-bundled skills is the measured shape of a workbench with plugins on.
    const skills: SkillListingEntry[] = Array.from({ length: 50 }, (_, i) => ({
      name: `skill-${i}`,
      description: `${i}:` + 'x'.repeat(2_000),
    }))

    const out = buildSkillsContext(skills, {}, cwd)!
    expect(out.length).toBeLessThanOrEqual(8_000)
    expect(out).toContain('/skill-49')
    expect(out).not.toContain('/skill-49:')
    expect(out).not.toContain('additional skills omitted')
  })

  it('reports omissions only when even the name-only roster cannot fit', () => {
    const skills: SkillListingEntry[] = Array.from({ length: 1_000 }, (_, i) => ({
      name: `very-long-skill-name-${String(i).padStart(4, '0')}`,
      description: 'Description',
    }))

    const out = buildSkillsContext(skills, {}, cwd)!
    expect(out.length).toBeLessThanOrEqual(8_000)
    expect(out).toContain('additional skills omitted')
    expect(out).toContain('action="list"')
    expect(out).not.toContain('/very-long-skill-name-0999')
  })

  it('does not add an omission notice when the full roster fits', () => {
    const out = buildSkillsContext(
      [
        { name: 'one', description: 'First' },
        { name: 'two', description: 'Second' },
      ],
      {},
      cwd,
    )!
    expect(out).toBe('- /one: First\n- /two: Second')
    expect(out).not.toContain('omitted')
  })
})
