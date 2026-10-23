import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { discoverFilesystemSkills } from '../agent-core/skill-discovery'
import { createSkillsCuratorService, CURATOR_INTERVAL_DAYS } from './service'
import { ARCHIVE_DIR_NAME } from './skill-fs'
import type { SkillScope, SkillUsageRecord, SkillUsageRepository } from './repository'

const DAY_MS = 24 * 60 * 60 * 1000
const USER = 'u1'

/** In-memory SkillUsageRepository — the curator only needs list/recordUse/setPinned/setArchivedAt. */
function createFakeRepo(nowIso: () => string) {
  const rows = new Map<string, SkillUsageRecord>()
  const key = (projectId: string, name: string, scope: SkillScope) =>
    `${projectId}:${scope}:${name}`
  const ensure = (projectId: string, name: string, scope: SkillScope): SkillUsageRecord => {
    const k = key(projectId, name, scope)
    let row = rows.get(k)
    if (!row) {
      row = {
        userId: USER,
        projectId,
        skillName: name,
        scope,
        getCount: 0,
        lastUsedAt: null,
        pinned: false,
        archivedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      rows.set(k, row)
    }
    return row
  }
  const repo: SkillUsageRepository = {
    async recordUse(_userId, projectId, name, scope, at) {
      const row = ensure(projectId, name, scope)
      row.getCount += 1
      row.lastUsedAt = at ?? nowIso()
    },
    async list(_userId, projectId) {
      return [...rows.values()].filter((row) => row.projectId === projectId)
    },
    async get(_userId, projectId, name, scope) {
      return rows.get(key(projectId, name, scope)) ?? null
    },
    async setPinned(_userId, projectId, name, scope, pinned) {
      const row = ensure(projectId, name, scope)
      row.pinned = pinned
      return { ...row }
    },
    async setArchivedAt(_userId, projectId, name, scope, archivedAt) {
      const row = ensure(projectId, name, scope)
      row.archivedAt = archivedAt
      return { ...row }
    },
  }
  return { repo, rows, ensure }
}

let base: string
let now: Date

async function writeSkill(name: string, opts?: { ageDays?: number; sub?: string }) {
  const dir = join(base, opts?.sub ?? '.localix/skills', name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: d\n---\nbody of ${name}\n`,
  )
  if (opts?.ageDays) {
    const ts = new Date(now.getTime() - opts.ageDays * DAY_MS)
    await fs.utimes(join(dir, 'SKILL.md'), ts, ts)
    await fs.utimes(dir, ts, ts)
  }
  return dir
}

function makeService(repo: SkillUsageRepository) {
  return createSkillsCuratorService({
    usageRepo: repo,
    globalBase: base,
    stateFile: join(base, 'curator-state.json'),
    now: () => now,
  })
}

beforeEach(async () => {
  base = await fs.mkdtemp(join(tmpdir(), 'curator-'))
  now = new Date('2026-06-11T12:00:00.000Z')
})
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('skills curator service', () => {
  test('starts pin persistence and project resolution concurrently', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    let pinStarted = false
    let cwdStarted = false
    let releasePin!: () => void
    let releaseCwd!: () => void
    const pinGate = new Promise<void>((resolve) => {
      releasePin = resolve
    })
    const cwdGate = new Promise<void>((resolve) => {
      releaseCwd = resolve
    })
    const service = createSkillsCuratorService({
      usageRepo: {
        ...repo,
        async setPinned(...args) {
          pinStarted = true
          await pinGate
          return repo.setPinned(...args)
        },
      },
      globalBase: base,
      stateFile: join(base, 'curator-state.json'),
      now: () => now,
      async resolveProjectCwd() {
        cwdStarted = true
        await cwdGate
        return null
      },
    })

    const pending = service.setPinned(USER, {
      name: 'project-skill',
      scope: 'project',
      pinned: true,
      projectId: 'project-1',
    })
    await Promise.resolve()
    expect(pinStarted).toBe(true)
    expect(cwdStarted).toBe(true)
    releasePin()
    releaseCwd()
    expect((await pending).pinned).toBe(true)
  })

  test('archives never-used skills older than 30 days; keeps fresh ones', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('old-unused', { ageDays: 45 })
    await writeSkill('fresh-unused', { ageDays: 5 })
    const service = makeService(repo)

    const report = await service.runCurator(USER)
    expect(report.archivedNow).toEqual(['old-unused'])
    expect(report.stale).toBe(1)
    expect(report.active).toBe(1)
    expect(report.archived).toBe(1)

    // Moved into the sibling .archive/ — recoverable, never deleted.
    const archivedMd = join(base, '.localix/skills', ARCHIVE_DIR_NAME, 'old-unused', 'SKILL.md')
    expect(await fs.readFile(archivedMd, 'utf8')).toContain('body of old-unused')
  })

  test('archives skills last used more than 90 days ago (stale-by-disuse)', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('disused', { ageDays: 200 })
    await writeSkill('in-use', { ageDays: 200 })
    await repo.recordUse(
      USER,
      '',
      'disused',
      'global',
      new Date(now.getTime() - 100 * DAY_MS).toISOString(),
    )
    await repo.recordUse(
      USER,
      '',
      'in-use',
      'global',
      new Date(now.getTime() - 10 * DAY_MS).toISOString(),
    )

    const report = await makeService(repo).runCurator(USER)
    expect(report.archivedNow).toEqual(['disused'])
    expect(report.active).toBe(1)
  })

  test('pinned skills are never auto-archived', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('pinned-old', { ageDays: 400 })
    await repo.setPinned(USER, '', 'pinned-old', 'global', true)

    const report = await makeService(repo).runCurator(USER)
    expect(report.archivedNow).toEqual([])
    expect(report.stale).toBe(0)
    expect(report.active).toBe(1)
  })

  test('only filesystem skill roots are inventoried (plugin/bundled skills excluded)', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('fs-skill', { ageDays: 1 })
    // A plugin skill outside the standalone .localix skill root must be invisible.
    await writeSkill('plugin-skill', { ageDays: 400, sub: 'plugins/some-plugin/skills' })

    const service = makeService(repo)
    const skills = await service.listSkills(USER)
    expect(skills.map((s) => s.name)).toEqual(['fs-skill'])

    const report = await service.runCurator(USER)
    expect(report.archivedNow).toEqual([])
    // Plugin skill untouched on disk.
    await fs.access(join(base, 'plugins/some-plugin/skills/plugin-skill/SKILL.md'))
  })

  test('manual archive moves the dir, hides it from discovery; restore brings it back', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    const dir = await writeSkill('to-archive')
    const service = makeService(repo)

    const archived = await service.archive(USER, { name: 'to-archive' })
    expect(archived.state).toBe('archived')
    expect(archived.archivedAt).not.toBeNull()
    expect(await fs.exists(dir)).toBe(false)

    // Discovery (what the agent sees) excludes .archive entirely.
    const discovered = await discoverFilesystemSkills(base)
    expect(discovered.filter((s) => s.dir.startsWith(base)).map((s) => s.name)).toEqual([])

    // But the curator list still shows it as archived.
    const listed = await service.listSkills(USER)
    expect(listed.find((s) => s.name === 'to-archive')?.state).toBe('archived')

    const restored = await service.restore(USER, { name: 'to-archive' })
    expect(restored.state).toBe('active')
    expect(await fs.readFile(join(dir, 'SKILL.md'), 'utf8')).toContain('body of to-archive')
    const after = await discoverFilesystemSkills(base)
    expect(after.filter((s) => s.dir.startsWith(base)).map((s) => s.name)).toEqual(['to-archive'])

    // Restored skill is not immediately re-archived (usage was reset).
    const report = await service.runCurator(USER)
    expect(report.archivedNow).toEqual([])
  })

  test('scheduled cadence: first call seeds the marker, runs only after 7 days', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('old-unused', { ageDays: 60 })
    const service = makeService(repo)

    // First observation: seed only, no pass.
    expect(await service.maybeRunScheduled(USER)).toBeNull()
    expect(await fs.exists(join(base, '.localix/skills', 'old-unused'))).toBe(true)

    // Within the interval: still no pass.
    now = new Date(now.getTime() + (CURATOR_INTERVAL_DAYS - 1) * DAY_MS)
    expect(await service.maybeRunScheduled(USER)).toBeNull()

    // Past the interval: a real pass runs and archives.
    now = new Date(now.getTime() + 2 * DAY_MS)
    const report = await service.maybeRunScheduled(USER)
    expect(report?.archivedNow).toEqual(['old-unused'])

    // Marker updated — immediately after, no second pass.
    expect(await service.maybeRunScheduled(USER)).toBeNull()
  })
})
