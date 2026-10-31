import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { discoverFilesystemSkills } from '../agent-core/skill-discovery'
import { createSkillsCuratorService, CURATOR_INTERVAL_DAYS } from './service'
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
        localixAuthored: false,
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
    async markAuthored(_userId, projectId, name, scope, createdAt) {
      const fresh = !rows.has(key(projectId, name, scope))
      const row = ensure(projectId, name, scope)
      if (fresh && createdAt) row.createdAt = createdAt
      row.localixAuthored = true
    },
  }
  fake = repo
  return { repo, rows, ensure }
}

let base: string
let now: Date
/** The repository of the running test, which `writeSkill` records authorship in. */
let fake: SkillUsageRepository

/** Writes a skill; by default one created in Localix (`authored: false`: Claude Code made it). */
async function writeSkill(
  name: string,
  opts?: { ageDays?: number; sub?: string; authored?: boolean },
) {
  const dir = join(base, opts?.sub ?? '.claude/skills', name)
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
  if (opts?.authored !== false && !opts?.sub) {
    const stamp = (await fs.stat(join(dir, 'SKILL.md'))).mtime.toISOString()
    await fake.markAuthored(USER, '', name, 'global', stamp)
  }
  return dir
}

function makeService(
  repo: SkillUsageRepository,
  extra: Partial<Parameters<typeof createSkillsCuratorService>[0]> = {},
) {
  return createSkillsCuratorService({
    usageRepo: repo,
    globalBase: base,
    archiveRoot: join(base, 'archive'),
    stateFile: join(base, 'curator-state.json'),
    now: () => now,
    ...extra,
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
      archiveRoot: join(base, 'archive'),
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

    // Moved outside `.claude/skills` (Claude Code reads it) — recoverable, never deleted.
    const archivedMd = join(base, 'archive', 'user', 'old-unused', 'SKILL.md')
    expect(await fs.readFile(archivedMd, 'utf8')).toContain('body of old-unused')
    expect(await fs.exists(join(base, '.claude/skills', 'old-unused'))).toBe(false)
    expect(await fs.exists(join(base, '.claude/skills/.archive'))).toBe(false)
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

    // Discovery (what the agent, and Claude Code, see) does not reach the archive.
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
    expect(await fs.exists(join(base, '.claude/skills', 'old-unused'))).toBe(true)

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

  test('a skill says when it goes stale and which scheduled pass archives it', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('never-used', { ageDays: 20 })
    await writeSkill('used', { ageDays: 200 })
    await repo.recordUse(
      USER,
      '',
      'used',
      'global',
      new Date(now.getTime() - 60 * DAY_MS).toISOString(),
    )
    // The last pass ran 3 days ago: the next is in 4 days, then every 7.
    const lastRunAt = new Date(now.getTime() - 3 * DAY_MS).toISOString()
    await fs.writeFile(join(base, 'curator-state.json'), JSON.stringify({ lastRunAt }))
    const listed = await makeService(repo).listSkills(USER)
    const at = (name: string) => listed.find((s) => s.name === name)!
    // Never used: stale 30 days after it was made (10 days ahead), so the pass of day 11.
    expect(at('never-used').staleAt).toBe(new Date(now.getTime() + 10 * DAY_MS).toISOString())
    expect(at('never-used').archiveOn).toBe(new Date(now.getTime() + 11 * DAY_MS).toISOString())
    // Used 60 days ago: stale 90 days after that (30 ahead), so the pass of day 32.
    expect(at('used').idleSince).toBe(new Date(now.getTime() - 60 * DAY_MS).toISOString())
    expect(at('used').archiveOn).toBe(new Date(now.getTime() + 32 * DAY_MS).toISOString())
  })

  test('a pinned skill, an archived one and a project one have no archive date', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('pinned', { ageDays: 400 })
    await repo.setPinned(USER, '', 'pinned', 'global', true)
    await writeSkill('mine', { ageDays: 5 })
    const service = makeService(repo, { resolveProjectCwd: async () => base })
    await service.archive(USER, { name: 'mine' })
    const [pinned, archived] = await service
      .listSkills(USER)
      .then((all) => [all.find((s) => s.name === 'pinned')!, all.find((s) => s.name === 'mine')!])
    expect([pinned.staleAt, pinned.archiveOn]).toEqual([null, null])
    expect([archived.staleAt, archived.archiveOn]).toEqual([null, null])
  })

  test('a project skill is stale but is never archived by the scheduled pass', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    const project = join(base, 'repo')
    await fs.mkdir(project, { recursive: true })
    const dir = join(project, '.claude/skills/deploy')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), '---\nname: deploy\ndescription: d\n---\nbody\n')
    const old = new Date(now.getTime() - 60 * DAY_MS)
    await fs.utimes(join(dir, 'SKILL.md'), old, old)
    await fake.markAuthored(USER, 'p1', 'deploy', 'project', old.toISOString())
    const service = makeService(repo, { resolveProjectCwd: async () => project })
    const [skill] = await service.listSkills(USER, { projectId: 'p1' })
    expect(skill?.state).toBe('stale')
    expect(skill?.archiveOn).toBeNull()
  })

  test('archiving the unused skips what was pinned or used since the preview', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    for (const name of ['a', 'b', 'c', 'd']) await writeSkill(name, { ageDays: 45 })
    const service = makeService(repo)
    const previewed = (await service.listSkills(USER)).filter((s) => s.state === 'stale')
    expect(previewed.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd'])
    await repo.setPinned(USER, '', 'b', 'global', true)
    await repo.recordUse(USER, '', 'c', 'global', now.toISOString())
    const done = await service.archiveUnused(USER, { names: ['a', 'b', 'c'] })
    expect(done.map((s) => s.name)).toEqual(['a'])
    const left = await service.listSkills(USER)
    expect(left.filter((s) => s.state === 'archived').map((s) => s.name)).toEqual(['a'])
    // d was stale but not confirmed: it stays.
    expect(left.find((s) => s.name === 'd')?.state).toBe('stale')
  })

  test('a scheduled pass that archived something says so once; one that did not is silent', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('old-one', { ageDays: 60 })
    await writeSkill('old-two', { ageDays: 60 })
    const told: string[][] = []
    const service = makeService(repo, { onArchived: (_user, names) => void told.push(names) })
    await service.maybeRunScheduled(USER)
    now = new Date(now.getTime() + 8 * DAY_MS)
    await service.maybeRunScheduled(USER)
    now = new Date(now.getTime() + 8 * DAY_MS)
    await service.maybeRunScheduled(USER)
    expect(told).toEqual([['old-one', 'old-two']])
  })

  test('a skill Claude Code made is never aged out: no stale state, no archive date, no scheduled archive', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('from-cc', { ageDays: 400, authored: false })
    await writeSkill('mine-old', { ageDays: 400 })
    const service = makeService(repo)

    const listed = await service.listSkills(USER)
    const cc = listed.find((s) => s.name === 'from-cc')!
    expect([cc.state, cc.staleAt, cc.archiveOn]).toEqual(['active', null, null])
    expect(listed.find((s) => s.name === 'mine-old')?.state).toBe('stale')

    const report = await service.runCurator(USER)
    expect(report.archivedNow).toEqual(['mine-old'])
    expect(await service.archiveUnused(USER, { names: ['from-cc'] })).toEqual([])
    expect(await fs.exists(join(base, '.claude/skills/from-cc/SKILL.md'))).toBe(true)
  })

  test('a skill Claude Code made can still be pinned, archived by hand and restored', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('from-cc', { authored: false })
    const service = makeService(repo)

    expect(
      (await service.setPinned(USER, { name: 'from-cc', scope: 'global', pinned: true })).pinned,
    ).toBe(true)
    expect((await service.archive(USER, { name: 'from-cc' })).state).toBe('archived')
    expect(await fs.exists(join(base, 'archive/user/from-cc/SKILL.md'))).toBe(true)
    expect((await service.restore(USER, { name: 'from-cc' })).state).toBe('active')
    expect(await fs.exists(join(base, '.claude/skills/from-cc/SKILL.md'))).toBe(true)
  })

  test('restoring does not overwrite a folder that appeared meanwhile', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    await writeSkill('twin')
    const service = makeService(repo)
    await service.archive(USER, { name: 'twin' })
    await fs.mkdir(join(base, '.claude/skills/twin'), { recursive: true })
    await fs.writeFile(join(base, '.claude/skills/twin/notes.txt'), 'mine')

    await expect(service.restore(USER, { name: 'twin' })).rejects.toThrow(/already exists/u)
    expect(await fs.exists(join(base, 'archive/user/twin/SKILL.md'))).toBe(true)
  })

  test('a project archives under its own id, outside the project folder tree Claude Code reads', async () => {
    const { repo } = createFakeRepo(() => now.toISOString())
    const project = join(base, 'repo')
    const dir = join(project, '.claude/skills/deploy')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), '---\nname: deploy\ndescription: d\n---\nbody\n')
    const service = makeService(repo, { resolveProjectCwd: async () => project })

    await service.archive(USER, { name: 'deploy', projectId: 'p1' })

    expect(await fs.exists(join(base, 'archive/p1/deploy/SKILL.md'))).toBe(true)
    expect(await fs.exists(join(project, '.claude/skills/deploy'))).toBe(false)
    const listed = await service.listSkills(USER, { projectId: 'p1' })
    expect(listed.map((s) => [s.name, s.state])).toEqual([['deploy', 'archived']])
  })
})
