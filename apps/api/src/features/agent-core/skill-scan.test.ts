import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readSkillsFromRoot } from './skill-scan'

/**
 * The plugin-bundled skill scan feeds the "# Skills" section of the system prompt, which
 * (a) sits inside the deploy-stable cached prefix and (b) is TRUNCATED at a char budget by
 * walking the list in order. So this order is not cosmetic: it decides both whether the
 * prefix re-prefills and which skills the model can see at all.
 */
let root: string

beforeAll(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'skill-scan-'))
  // Created in REVERSE alphabetical order on purpose: `readdir` commonly hands entries back
  // in creation/inode order, so a scan that just forwards it returns them backwards.
  for (const name of ['zulu', 'mike', 'alpha']) {
    const dir = join(root, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\nDoes ${name}.`)
  }
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('readSkillsFromRoot', () => {
  it('returns skills by NAME, not in filesystem order', async () => {
    const skills = await readSkillsFromRoot(root, 'global')
    expect(skills.map((s) => s.name)).toEqual(['alpha', 'mike', 'zulu'])
  })

  it('still returns every skill it found — the reverse direction', async () => {
    // Sorting must not drop or dedupe anything: the budget walk downstream already
    // decides what fits, and losing a skill here would hide it from the model entirely.
    const skills = await readSkillsFromRoot(root, 'global')
    expect(skills).toHaveLength(3)
    expect(skills.every((s) => s.content.length > 0)).toBe(true)
  })

  it('retains bodies only on first access and then freezes the loaded snapshot', async () => {
    const skillDir = join(root, 'lazy-snapshot')
    const skillPath = join(skillDir, 'SKILL.md')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(
      skillPath,
      '---\nname: lazy-snapshot\ndescription: metadata only\n---\n\nInitial body.',
    )

    try {
      const skill = (await readSkillsFromRoot(root, 'global')).find(
        (entry) => entry.name === 'lazy-snapshot',
      )!
      expect(typeof Object.getOwnPropertyDescriptor(skill, 'content')?.get).toBe('function')

      // Discovery parsed metadata but did not retain the old body. The first explicit
      // access observes the current file, then memoizes it for this immutable snapshot.
      await fs.writeFile(
        skillPath,
        '---\nname: lazy-snapshot\ndescription: metadata only\n---\n\nBody at invocation.',
      )
      expect(skill.content).toBe('Body at invocation.')
      await fs.writeFile(
        skillPath,
        '---\nname: lazy-snapshot\ndescription: metadata only\n---\n\nLater edit.',
      )
      expect(skill.content).toBe('Body at invocation.')
    } finally {
      await fs.rm(skillDir, { recursive: true, force: true })
    }
  })

  it('maps openai.yaml allow_implicit_invocation=false onto the existing explicit-only policy', async () => {
    const skillDir = join(root, 'explicit-only')
    await fs.mkdir(join(skillDir, 'agents'), { recursive: true })
    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: explicit-only\ndescription: run only when requested\n---\n\nExplicit body.',
    )
    await fs.writeFile(
      join(skillDir, 'agents', 'openai.yaml'),
      'interface:\n  display_name: Explicit Only\npolicy:\n  allow_implicit_invocation: false\n',
    )

    try {
      const skill = (await readSkillsFromRoot(root, 'global')).find(
        (entry) => entry.name === 'explicit-only',
      )!
      // The model roster consumes this flag; explicit get/pin/slash paths do not,
      // and the body therefore remains available for an explicit invocation.
      expect(skill.disableModelInvocation).toBe(true)
      expect(skill.content).toBe('Explicit body.')
    } finally {
      await fs.rm(skillDir, { recursive: true, force: true })
    }
  })

  it('keeps implicit invocation enabled for true, missing, and non-boolean policy values', async () => {
    const cases = [
      ['metadata-true', 'policy:\n  allow_implicit_invocation: true\n'],
      ['metadata-string', 'policy:\n  allow_implicit_invocation: "false"\n'],
      ['metadata-missing', 'interface:\n  display_name: Metadata only\n'],
    ] as const

    try {
      for (const [name, metadata] of cases) {
        const skillDir = join(root, name)
        await fs.mkdir(join(skillDir, 'agents'), { recursive: true })
        await fs.writeFile(
          join(skillDir, 'SKILL.md'),
          `---\nname: ${name}\ndescription: policy case\n---\n\nBody.`,
        )
        await fs.writeFile(join(skillDir, 'agents', 'openai.yaml'), metadata)
      }

      const skills = await readSkillsFromRoot(root, 'global')
      for (const [name] of cases) {
        expect(skills.find((entry) => entry.name === name)?.disableModelInvocation).toBeUndefined()
      }
    } finally {
      await Promise.all(
        cases.map(([name]) => fs.rm(join(root, name), { recursive: true, force: true })),
      )
    }
  })

  it('fails open with a diagnostic when optional openai.yaml is malformed', async () => {
    const skillDir = join(root, 'bad-metadata')
    const warnings: Array<{ message: string; meta?: unknown }> = []
    await fs.mkdir(join(skillDir, 'agents'), { recursive: true })
    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: bad-metadata\ndescription: valid skill\n---\n\nStill usable.',
    )
    await fs.writeFile(join(skillDir, 'agents', 'openai.yaml'), 'policy: [not valid\n')

    try {
      const skill = (
        await readSkillsFromRoot(root, 'global', {
          warn: (message, meta) => warnings.push({ message, meta }),
        })
      ).find((entry) => entry.name === 'bad-metadata')!
      expect(skill.disableModelInvocation).toBeUndefined()
      expect(skill.content).toBe('Still usable.')
      expect(
        warnings.some(({ meta }) => (meta as { code?: string })?.code === 'metadata_read_failed'),
      ).toBe(true)
    } finally {
      await fs.rm(skillDir, { recursive: true, force: true })
    }
  })

  it('rejects project metadata symlinks that escape the skill root', async () => {
    const skillDir = join(root, 'escaping-metadata')
    const outsideDir = await fs.mkdtemp(join(tmpdir(), 'skill-metadata-outside-'))
    const warnings: Array<{ meta?: unknown }> = []
    await fs.mkdir(join(skillDir, 'agents'), { recursive: true })
    await fs.writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: escaping-metadata\ndescription: confined metadata\n---\n\nBody.',
    )
    const outsideMetadata = join(outsideDir, 'openai.yaml')
    await fs.writeFile(outsideMetadata, 'policy:\n  allow_implicit_invocation: false\n')
    await fs.symlink(outsideMetadata, join(skillDir, 'agents', 'openai.yaml'))

    try {
      const skill = (
        await readSkillsFromRoot(root, 'project', {
          warn: (_message, meta) => warnings.push({ meta }),
        })
      ).find((entry) => entry.name === 'escaping-metadata')!
      expect(skill.disableModelInvocation).toBeUndefined()
      expect(
        warnings.some(
          ({ meta }) => (meta as { code?: string })?.code === 'metadata_symlink_escape',
        ),
      ).toBe(true)
    } finally {
      await fs.rm(skillDir, { recursive: true, force: true })
      await fs.rm(outsideDir, { recursive: true, force: true })
    }
  })
})
