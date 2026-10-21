import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { makeTempDir } from '@localixai/testing'
import { join } from 'node:path'
import { createSkill, skillNameFromId, updateSkill, type SkillOpsContext } from './skill-ops'

/**
 * `updateSkill` used to be a create-in-disguise: it ignored the id it was handed and just
 * wrote the new draft. A RENAME therefore wrote a fresh `<newName>` directory and left the
 * original `<oldName>` behind — a second, shadowing skill of the old name (not data loss;
 * the original file was intact, just orphaned). Name is the identity everywhere in this
 * subsystem, so the fix removes the old-named skill after writing the renamed one.
 *
 * Temp dirs live INSIDE the workspace on purpose: writes under `/tmp` trip the sandbox's
 * approval prompt and hang an unattended run (mirrors skills.test.ts). Only PROJECT scope
 * is exercised — global writes go to the real `homedir()` via `createSkill`.
 */
const tmpBase = async (label: string): Promise<string> => makeTempDir(`localix-${label}`)

/** A ctx whose project working dir is a throwaway temp base. */
const ctxFor = (base: string): SkillOpsContext => ({
  now: () => '2026-07-14T00:00:00.000Z',
  resolveProjectWorkingDir: async () => base,
})

const skillDir = (base: string, name: string): string => join(base, '.localix/skills', name)
const exists = async (path: string): Promise<boolean> =>
  fs.access(path).then(
    () => true,
    () => false,
  )

describe('skillNameFromId', () => {
  test('extracts the skill (directory) name from a file: id', () => {
    expect(skillNameFromId('file:/repo/.localix/skills/deploy/SKILL.md')).toBe('deploy')
    expect(skillNameFromId('file:/home/.claude/skills/lint-fix/SKILL.md')).toBe('lint-fix')
  })

  test('returns undefined for a shape it cannot read (falls back to create-only)', () => {
    expect(skillNameFromId('db:123')).toBeUndefined()
    expect(skillNameFromId('')).toBeUndefined()
    expect(skillNameFromId('file:')).toBeUndefined()
  })
})

describe('updateSkill', () => {
  test('a RENAME removes the old skill (no shadowing duplicate)', async () => {
    const base = await tmpBase('skill-rename')
    try {
      const ctx = ctxFor(base)
      const created = await createSkill(ctx, 'u1', {
        name: 'old-name',
        description: 'd',
        content: 'body',
        projectId: 'p1',
      })
      expect(await exists(join(skillDir(base, 'old-name'), 'SKILL.md'))).toBe(true)

      await updateSkill(ctx, 'u1', created.id, {
        name: 'new-name',
        description: 'd',
        content: 'body',
        projectId: 'p1',
      })

      // The renamed skill exists…
      expect(await exists(join(skillDir(base, 'new-name'), 'SKILL.md'))).toBe(true)
      // …and the original is GONE — not orphaned as a second skill of the old name.
      expect(await exists(skillDir(base, 'old-name'))).toBe(false)
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  test('a same-name edit rewrites in place and leaves exactly one skill', async () => {
    const base = await tmpBase('skill-inplace')
    try {
      const ctx = ctxFor(base)
      const created = await createSkill(ctx, 'u1', {
        name: 'deploy',
        description: 'old',
        content: 'body',
        projectId: 'p1',
      })

      await updateSkill(ctx, 'u1', created.id, {
        name: 'deploy',
        description: 'new',
        content: 'body',
        projectId: 'p1',
      })

      const raw = await fs.readFile(join(skillDir(base, 'deploy'), 'SKILL.md'), 'utf8')
      expect(raw).toContain('description: new')
      // No second directory sprang up next to it.
      const dirs = await fs.readdir(join(base, '.localix/skills'))
      expect(dirs).toEqual(['deploy'])
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })

  test('a rename whose id is unreadable does not delete anything (safe fallback)', async () => {
    const base = await tmpBase('skill-badid')
    try {
      const ctx = ctxFor(base)
      await createSkill(ctx, 'u1', {
        name: 'keeper',
        description: 'd',
        content: 'b',
        projectId: 'p1',
      })

      // An id we cannot parse → create-only, no guessed deletion.
      await updateSkill(ctx, 'u1', 'not-a-file-id', {
        name: 'renamed',
        description: 'd',
        content: 'b',
        projectId: 'p1',
      })

      expect(await exists(skillDir(base, 'renamed'))).toBe(true)
      expect(await exists(skillDir(base, 'keeper'))).toBe(true) // untouched
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
  })
})
