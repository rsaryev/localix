import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverFilesystemSkills, writeSkillFile } from './skill-discovery'
import { MAX_SKILL_MARKDOWN_BYTES } from './skill-file'
import { MAX_SKILL_SCAN_DEPTH } from './skill-scan'
import { validateSkillFile } from './skill-validate'

type Warning = { message: string; meta?: Record<string, unknown> }

const logger = (warnings: Warning[]) => ({
  warn(message: string, meta?: unknown) {
    warnings.push({ message, meta: meta as Record<string, unknown> | undefined })
  },
})

async function fixture(): Promise<{ home: string; project: string; cleanup: () => Promise<void> }> {
  const home = await fs.mkdtemp(join(tmpdir(), 'skill-safe-home-'))
  const project = join(home, 'project')
  await fs.mkdir(project)
  return {
    home,
    project,
    cleanup: () => fs.rm(home, { recursive: true, force: true }),
  }
}

describe('bounded and symlink-safe skill discovery', () => {
  test('discovers nested portable skills and stops below a skill root', async () => {
    const { home, project, cleanup } = await fixture()
    try {
      const category = join(project, '.claude', 'skills', 'language', 'typescript')
      const nestedBelowSkill = join(category, 'hidden-child')
      await fs.mkdir(nestedBelowSkill, { recursive: true })
      await fs.writeFile(
        join(category, 'SKILL.md'),
        '---\nname: nested-typescript\ndescription: nested\n---\nUse TypeScript.',
      )
      await fs.writeFile(
        join(nestedBelowSkill, 'SKILL.md'),
        '---\nname: must-not-load\ndescription: child\n---\nDo not load.',
      )

      const skills = await discoverFilesystemSkills(project, home)

      expect(skills.find((skill) => skill.name === 'nested-typescript')?.content).toBe(
        'Use TypeScript.',
      )
      expect(skills.find((skill) => skill.name === 'must-not-load')).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  test('bounds nested portable skill discovery depth with a diagnostic', async () => {
    const { home, project, cleanup } = await fixture()
    try {
      const segments = Array.from({ length: MAX_SKILL_SCAN_DEPTH + 1 }, (_, i) => `level-${i}`)
      const tooDeep = join(project, '.claude', 'skills', ...segments)
      await fs.mkdir(tooDeep, { recursive: true })
      await fs.writeFile(
        join(tooDeep, 'SKILL.md'),
        '---\nname: too-deep\ndescription: hidden\n---\nDo not load.',
      )

      const warnings: Warning[] = []
      const skills = await discoverFilesystemSkills(project, home, logger(warnings))

      expect(skills.find((skill) => skill.name === 'too-deep')).toBeUndefined()
      expect(warnings.some((warning) => warning.meta?.code === 'depth_limit')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('skips oversized SKILL.md files with actionable diagnostics', async () => {
    const { home, project, cleanup } = await fixture()
    try {
      const skillDir = join(project, '.claude', 'skills', 'huge-skill')
      await fs.mkdir(skillDir, { recursive: true })
      const oversized = 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES + 1)
      await fs.writeFile(join(skillDir, 'SKILL.md'), oversized)

      const warnings: Warning[] = []
      const skills = await discoverFilesystemSkills(project, home, logger(warnings))

      expect(skills.find((skill) => skill.name === 'huge-skill')).toBeUndefined()
      expect(warnings.filter((warning) => warning.meta?.errorCode === 'too_large')).toHaveLength(1)
      expect(warnings.every((warning) => warning.message.includes('limit is'))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('rejects invalid UTF-8 instead of injecting replacement characters', async () => {
    const { home, project, cleanup } = await fixture()
    try {
      const skillDir = join(project, '.claude', 'skills', 'binary')
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(join(skillDir, 'SKILL.md'), Buffer.from([0xff, 0xfe, 0xfd]))

      const warnings: Warning[] = []
      const skills = await discoverFilesystemSkills(project, home, logger(warnings))

      expect(skills.find((skill) => skill.name === 'binary')).toBeUndefined()
      expect(warnings.some((warning) => warning.meta?.errorCode === 'invalid_utf8')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('lazy body reads recheck the size ceiling and refuse a raced symlink replacement', async () => {
    const { home, project, cleanup } = await fixture()
    const outside = await fs.mkdtemp(join(tmpdir(), 'skill-lazy-outside-'))
    try {
      const skillDir = join(project, '.claude', 'skills', 'lazy-safe')
      const skillPath = join(skillDir, 'SKILL.md')
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(
        skillPath,
        '---\nname: lazy-safe\ndescription: safe metadata\n---\nOriginal body.',
      )

      const oversizedSkill = (await discoverFilesystemSkills(project, home)).find(
        (skill) => skill.name === 'lazy-safe',
      )!
      await fs.writeFile(skillPath, 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES + 1))
      expect(() => oversizedSkill.content).toThrow(`limit is ${MAX_SKILL_MARKDOWN_BYTES} bytes`)

      await fs.writeFile(
        skillPath,
        '---\nname: lazy-safe\ndescription: safe metadata\n---\nOriginal body.',
      )
      const symlinkSkill = (await discoverFilesystemSkills(project, home)).find(
        (skill) => skill.name === 'lazy-safe',
      )!
      const secret = join(outside, 'secret.md')
      await fs.writeFile(secret, 'SECRET MUST NOT LOAD')
      await fs.unlink(skillPath)
      await fs.symlink(secret, skillPath, 'file')
      expect(() => symlinkSkill.content).toThrow()
    } finally {
      await Promise.all([cleanup(), fs.rm(outside, { recursive: true, force: true })])
    }
  })

  test('blocks project skill symlinks that escape the project root', async () => {
    const { home, project, cleanup } = await fixture()
    const outside = await fs.mkdtemp(join(tmpdir(), 'skill-safe-outside-'))
    try {
      const externalSkill = join(outside, 'external-skill')
      await fs.mkdir(externalSkill)
      await fs.writeFile(
        join(externalSkill, 'SKILL.md'),
        '---\nname: escaped-skill\ndescription: must stay out\n---\nDo not load.',
      )
      const skillContainer = join(project, '.claude', 'skills')
      await fs.mkdir(skillContainer, { recursive: true })
      await fs.symlink(externalSkill, join(skillContainer, 'escaped-skill'), 'dir')

      const warnings: Warning[] = []
      const skills = await discoverFilesystemSkills(project, home, logger(warnings))

      expect(skills.find((skill) => skill.name.includes('escaped'))).toBeUndefined()
      expect(warnings.filter((warning) => warning.meta?.code === 'symlink_escape')).toHaveLength(1)
    } finally {
      await Promise.all([cleanup(), fs.rm(outside, { recursive: true, force: true })])
    }
  })

  test('deduplicates skill directory symlink cycles deterministically', async () => {
    const { home, project, cleanup } = await fixture()
    try {
      const skillsRoot = join(project, '.claude', 'skills')
      const once = join(skillsRoot, 'once')
      await fs.mkdir(once, { recursive: true })
      await fs.writeFile(
        join(once, 'SKILL.md'),
        '---\nname: once\ndescription: once\n---\nRun once.',
      )
      await fs.symlink(skillsRoot, join(skillsRoot, 'loop'), 'dir')

      const warnings: Warning[] = []
      const skills = await discoverFilesystemSkills(project, home, logger(warnings))

      expect(skills.filter((skill) => skill.name === 'once')).toHaveLength(1)
      expect(
        warnings.some(
          (warning) =>
            warning.meta?.code === 'duplicate_canonical_path' &&
            warning.message.includes('cycle/alias'),
        ),
      ).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('validation and writes fail closed on oversized skill markdown', async () => {
    const { project, cleanup } = await fixture()
    try {
      const skillDir = join(project, '.claude', 'skills', 'huge')
      const skillPath = join(skillDir, 'SKILL.md')
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(skillPath, 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES + 1))

      const validation = await validateSkillFile(skillPath)
      expect(validation.errors).toHaveLength(1)
      expect(validation.errors[0]).toContain(`limit is ${MAX_SKILL_MARKDOWN_BYTES} bytes`)
      expect(
        writeSkillFile(
          project,
          { name: 'new-huge', description: 'huge', content: 'x'.repeat(MAX_SKILL_MARKDOWN_BYTES) },
          'project',
        ),
      ).rejects.toThrow(`limit is ${MAX_SKILL_MARKDOWN_BYTES} bytes`)
    } finally {
      await cleanup()
    }
  })

  test('refuses edits and creates through project skill symlinks that escape the root', async () => {
    const { project, cleanup } = await fixture()
    const outside = await fs.mkdtemp(join(tmpdir(), 'skill-write-outside-'))
    try {
      const container = join(project, '.claude', 'skills')
      const existingTarget = join(outside, 'existing')
      const newTarget = join(outside, 'new')
      await Promise.all([
        fs.mkdir(container, { recursive: true }),
        fs.mkdir(existingTarget, { recursive: true }),
        fs.mkdir(newTarget, { recursive: true }),
      ])
      const original = '---\nname: escaped-edit\ndescription: original\n---\nOriginal.'
      await fs.writeFile(join(existingTarget, 'SKILL.md'), original)
      await fs.symlink(existingTarget, join(container, 'escaped-edit'), 'dir')
      await fs.symlink(newTarget, join(container, 'escaped-create'), 'dir')

      expect(
        writeSkillFile(
          project,
          { name: 'escaped-edit', description: 'changed', content: 'Changed.' },
          'project',
        ),
      ).rejects.toThrow('escaping symlink')
      expect(
        writeSkillFile(
          project,
          { name: 'escaped-create', description: 'new', content: 'New.' },
          'project',
        ),
      ).rejects.toThrow('escaping symlink')
      expect(await fs.readFile(join(existingTarget, 'SKILL.md'), 'utf8')).toBe(original)
      expect(fs.access(join(newTarget, 'SKILL.md'))).rejects.toBeDefined()
    } finally {
      await Promise.all([cleanup(), fs.rm(outside, { recursive: true, force: true })])
    }
  })
})
