import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { makeTempDir } from '@localixai/testing'
import { join } from 'node:path'
import { writeTree } from '@localixai/testing'
import { diskPluginHost } from '../../plugins/kit/testing'
import { scopeSkills } from '../../plugins/kit'
import {
  createSkill,
  getSkill,
  listSkills,
  skillNameFromId,
  updateSkill,
  type SkillOpsContext,
} from './skill-ops'

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
  // The kit's listing of the project folder, with a home and managed folder of the test's own.
  scopeSkills: async () => {
    const managed = join(base, 'managed')
    writeTree(managed, { 'managed-settings.json': '{}' })
    const home = join(base, 'home')
    return scopeSkills(diskPluginHost(home, { managedDirectory: managed }), {
      cwd: base,
      homeDir: home,
      plugins: [],
      managed: { dir: managed },
    })
  },
})

const skillDir = (base: string, name: string): string => join(base, '.claude/skills', name)
const exists = async (path: string): Promise<boolean> =>
  fs.access(path).then(
    () => true,
    () => false,
  )

describe('skillNameFromId', () => {
  test('extracts the skill (directory) name from a file: id', () => {
    expect(skillNameFromId('file:/repo/.claude/skills/deploy/SKILL.md')).toBe('deploy')
    expect(skillNameFromId('file:/home/.claude/skills/lint-fix/SKILL.md')).toBe('lint-fix')
  })

  test('returns undefined for a shape it cannot read (falls back to create-only)', () => {
    expect(skillNameFromId('db:123')).toBeUndefined()
    expect(skillNameFromId('')).toBeUndefined()
    expect(skillNameFromId('file:')).toBeUndefined()
  })
})

describe('listSkills and getSkill', () => {
  test("list the scope's skills as the kit reads them, with each file's issues; get reads one body", async () => {
    const base = await tmpBase('skill-list')
    try {
      writeTree(base, {
        '.git/HEAD': '',
        '.claude/skills/deploy/SKILL.md':
          '---\ndescription: Ship it\nargument-hint: "[env]"\nuser-invocable: maybe\n---\nDeploy body\n',
        'home/.claude/skills/mine/SKILL.md': '---\ndescription: Mine\n---\nMine body\n',
      })
      const ctx = ctxFor(base)
      const { skills } = await listSkills(ctx, 'u1', { projectId: 'p1' })
      const deploy = skills.find((one) => one.name === 'deploy')
      expect(deploy).toMatchObject({
        description: 'Ship it',
        scope: 'project',
        projectId: 'p1',
        argumentHint: '[env]',
        content: '',
      })
      expect(deploy?.validation?.warnings.length).toBeGreaterThan(0)
      expect(skills.find((one) => one.name === 'mine')).toMatchObject({
        scope: 'global',
        projectId: '',
      })
      const full = await getSkill(ctx, 'u1', 'deploy', { projectId: 'p1' })
      expect(full.content).toContain('Deploy body')
      await expect(getSkill(ctx, 'u1', 'nothing', { projectId: 'p1' })).rejects.toThrow(/not found/)
    } finally {
      await fs.rm(base, { recursive: true, force: true })
    }
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
      const dirs = await fs.readdir(join(base, '.claude/skills'))
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
