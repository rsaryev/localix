import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { discoverFilesystemSkills } from '../agent-core/skill-discovery'
import { migrateLegacySkills } from './legacy-skills-migration'
import { createSkillUsageRepository } from './repository'

const dir = tempDirPerTest('legacy-skills-')
let db: ReturnType<typeof createDatabase>
const logs: Array<{ level: string; fields: Record<string, unknown> }> = []
const logger = {
  info: (fields: object) => logs.push({ level: 'info', fields: fields as Record<string, unknown> }),
  warn: (fields: object) => logs.push({ level: 'warn', fields: fields as Record<string, unknown> }),
}

beforeEach(async () => {
  db = createDatabase()
  await migrateToLatest(db)
  logs.length = 0
})
afterEach(() => destroyDatabase(db))

const exists = (path: string) =>
  fs.access(path).then(
    () => true,
    () => false,
  )

async function skill(root: string, name: string, body = `body of ${name}`): Promise<string> {
  const folder = join(root, name)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}\n`)
  await fs.writeFile(join(folder, 'script.sh'), 'echo hi\n')
  return folder
}

function run(projects: Array<{ id: string; workingDir: string }> = []) {
  const home = join(dir(), 'home')
  return {
    home,
    usage: createSkillUsageRepository(db),
    go: () =>
      migrateLegacySkills({
        userId: 'u1',
        homeDir: home,
        archiveRoot: join(home, '.localix', 'skills-archive'),
        markerFile: join(home, '.localix', 'skills-claude-layout.json'),
        projects: async () => projects,
        usage: createSkillUsageRepository(db),
        logger,
      }),
  }
}

describe('the one-time move of .localix/skills to .claude/skills', () => {
  test('moves whole folders of the home and of each project, and removes the old folders', async () => {
    const repo = join(dir(), 'repo')
    const { home, go } = run([{ id: 'p1', workingDir: repo }])
    await skill(join(home, '.localix/skills'), 'mine')
    await skill(join(repo, '.localix/skills'), 'deploy')

    const report = await go()

    expect(report?.moved).toHaveLength(2)
    expect(await fs.readFile(join(home, '.claude/skills/mine/script.sh'), 'utf8')).toBe('echo hi\n')
    expect(await exists(join(repo, '.claude/skills/deploy/SKILL.md'))).toBe(true)
    expect(await exists(join(home, '.localix/skills'))).toBe(false)
    expect(await exists(join(repo, '.localix/skills'))).toBe(false)
    // Claude Code's layout is all discovery reads, and it finds them.
    const found = await discoverFilesystemSkills(repo, home)
    expect(found.map((s) => s.name)).toEqual(['deploy', 'mine'])
  })

  test('on a name the .claude folder holds, that one wins and the old one is dropped and logged', async () => {
    const { home, go } = run()
    await skill(join(home, '.claude/skills'), 'review', 'claude body')
    await skill(join(home, '.localix/skills'), 'review', 'localix body')

    const report = await go()

    expect(report?.dropped).toEqual([join(home, '.localix/skills/review')])
    expect(await fs.readFile(join(home, '.claude/skills/review/SKILL.md'), 'utf8')).toContain(
      'claude body',
    )
    expect(await exists(join(home, '.claude/skills/review-localix'))).toBe(false)
    expect(await exists(join(home, '.localix/skills'))).toBe(false)
    expect(
      logs.some((l) => l.level === 'warn' && l.fields.event === 'skills.migrate.dropped'),
    ).toBe(true)
  })

  test('archived skills go to the archive folder outside .claude/skills', async () => {
    const repo = join(dir(), 'repo')
    const { home, go } = run([{ id: 'p1', workingDir: repo }])
    await skill(join(home, '.localix/skills/.archive'), 'old')
    await skill(join(repo, '.localix/skills/.archive'), 'older')

    await go()

    expect(await exists(join(home, '.localix/skills-archive/user/old/SKILL.md'))).toBe(true)
    expect(await exists(join(home, '.localix/skills-archive/p1/older/SKILL.md'))).toBe(true)
    expect(await exists(join(home, '.claude/skills'))).toBe(false)
    expect(await exists(join(home, '.localix/skills'))).toBe(false)
    expect(await exists(join(repo, '.localix/skills'))).toBe(false)
  })

  test('moved skills count as created in Localix, dated by their file; others do not', async () => {
    const { home, usage, go } = run()
    const old = new Date('2026-01-02T00:00:00.000Z')
    const folder = await skill(join(home, '.localix/skills'), 'mine')
    await fs.utimes(join(folder, 'SKILL.md'), old, old)
    await skill(join(home, '.claude/skills'), 'cc-made')
    await usage.recordUse('u1', '', 'mine', 'global', '2026-02-01T00:00:00.000Z')

    await go()

    const mine = await usage.get('u1', '', 'mine', 'global')
    expect(mine?.localixAuthored).toBe(true)
    expect(mine?.getCount).toBe(1)
    expect(await usage.get('u1', '', 'cc-made', 'global')).toBeNull()
  })

  test('runs once: a marker is left, and a second start touches nothing', async () => {
    const { home, go } = run()
    await skill(join(home, '.localix/skills'), 'mine')
    expect(await go()).not.toBeNull()
    expect(await exists(join(home, '.localix/skills-claude-layout.json'))).toBe(true)

    await skill(join(home, '.localix/skills'), 'late')
    expect(await go()).toBeNull()
    expect(await exists(join(home, '.localix/skills/late'))).toBe(true)
  })

  test('a project folder that is gone is skipped and does not stop the move', async () => {
    const { home, go } = run([{ id: 'p1', workingDir: join(dir(), 'gone') }])
    await skill(join(home, '.localix/skills'), 'mine')

    const report = await go()

    expect(report?.failed).toEqual([])
    expect(await exists(join(home, '.claude/skills/mine/SKILL.md'))).toBe(true)
  })
})
