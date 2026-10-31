import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase, destroyDatabase, migrateToLatest } from '../../db'
import { createProjectsRepository } from './repository'
import {
  DEFAULT_PROJECT_NAME,
  defaultProjectDir,
  normalizeProjectDir,
  resolveDefaultProject,
} from './default-project'

/**
 * The default project exists so "no project" stops meaning the `global` capability scope.
 *
 * That conflation was the bug: `scopeFor(null)` returned `global`, so switching a tool off in a
 * project-less chat wrote an installation-wide rule — and composition makes a denial monotone,
 * so no scope below could ever undo it. On the machine this was found on, every session was
 * project-less and no project existed, which made it 100 % of usage rather than an edge.
 */
describe('the default project', () => {
  let dir = ''
  let db: ReturnType<typeof createDatabase>
  const now = () => '2026-06-01T00:00:00.000Z'

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-default-project-'))
    db = createDatabase({ filename: join(dir, 'db.sqlite') })
    await migrateToLatest(db)
  })
  afterAll(async () => {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  })

  test('is created once and then found, so a scope survives a restart', async () => {
    const repo = createProjectsRepository(db)
    const first = await resolveDefaultProject(repo, 'u1', now)
    expect(first.name).toBe(DEFAULT_PROJECT_NAME)
    expect(first.workingDir).toBe(defaultProjectDir())

    const second = await resolveDefaultProject(repo, 'u1', now)
    expect(second.id).toBe(first.id)
    expect((await repo.listProjects('u1')).length).toBe(1)
  })

  test('is matched by DIRECTORY, so renaming it keeps it the default', async () => {
    const repo = createProjectsRepository(db)
    const created = await resolveDefaultProject(repo, 'u2', now)
    await repo.updateProject('u2', created.id, { ...created, name: 'Scratch' })

    const found = await resolveDefaultProject(repo, 'u2', now)
    expect(found.id).toBe(created.id)
    expect(found.name).toBe('Scratch')
    expect((await repo.listProjects('u2')).length).toBe(1)
  })

  test('is per user — one installation scope is not shared across accounts', async () => {
    const repo = createProjectsRepository(db)
    const mine = await resolveDefaultProject(repo, 'u3', now)
    const theirs = await resolveDefaultProject(repo, 'u4', now)
    expect(mine.id).not.toBe(theirs.id)
  })
})

/**
 * Deleting a project is SOFT, and re-opening its directory brings it back.
 *
 * A session's `project_id` is NOT NULL, so a hard delete could only orphan its conversations
 * into the global capability scope — the conflation the default project exists to end — or
 * take them with it. Neither is what "delete this project" means, so the row stays, hidden.
 */
describe('project soft delete', () => {
  let dir = ''
  let db: ReturnType<typeof createDatabase>
  const now = () => '2026-06-01T00:00:00.000Z'

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'localix-soft-delete-'))
    db = createDatabase({ filename: join(dir, 'db.sqlite') })
    await migrateToLatest(db)
  })
  afterAll(async () => {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  })

  // Ids well past the allocator's counter: `resolveDefaultProject` mints `PRJ-<seq>` from a
  // sequence starting at 1, and a hand-written `PRJ-1` in the same database collides with it.
  const project = (id: string, workingDir: string) => ({
    id,
    seq: Number(id.slice('PRJ-'.length)),
    userId: 'u',
    name: id,
    workingDir,
    settings: null,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  })

  test('hides the project from every ordinary read but keeps the row', async () => {
    const repo = createProjectsRepository(db)
    await repo.insertProject(project('PRJ-901', '/work/one'))
    await repo.deleteProject('u', 'PRJ-901', now())

    expect(await repo.listProjects('u')).toEqual([])
    // The session path reads through `getProject`, which must still answer: deletion hid the
    // project, it did not end the conversations inside it.
    expect((await repo.getProject('u', 'PRJ-901'))?.deletedAt).toBe(now())
    expect((await repo.listAllProjects('u')).map((p) => p.id)).toContain('PRJ-901')
  })

  test('re-opening the same directory revives it instead of minting a second row', async () => {
    const repo = createProjectsRepository(db)
    await repo.insertProject(project('PRJ-902', '/work/two'))
    await repo.deleteProject('u', 'PRJ-902', now())
    await repo.restoreProject('u', 'PRJ-902')

    // Same id, so its sessions still point at it and its capability rules are still its own. A
    // fresh row for the same path would split that scope in two.
    expect((await repo.listProjects('u')).map((p) => p.id)).toContain('PRJ-902')
    expect((await repo.getProject('u', 'PRJ-902'))?.deletedAt).toBeNull()
  })

  test('deleting twice keeps the first deletion time', async () => {
    const repo = createProjectsRepository(db)
    await repo.insertProject(project('PRJ-903', '/work/three'))
    await repo.deleteProject('u', 'PRJ-903', '2026-06-01T00:00:00.000Z')
    await repo.deleteProject('u', 'PRJ-903', '2026-09-09T00:00:00.000Z')
    expect((await repo.getProject('u', 'PRJ-903'))?.deletedAt).toBe('2026-06-01T00:00:00.000Z')
  })

  test('the default project is revived rather than duplicated', async () => {
    const repo = createProjectsRepository(db)
    const first = await resolveDefaultProject(repo, 'u-default', now)
    await repo.deleteProject('u-default', first.id, now())

    const again = await resolveDefaultProject(repo, 'u-default', now)
    expect(again.id).toBe(first.id)
    expect(again.deletedAt).toBeNull()
    expect((await repo.listAllProjects('u-default')).length).toBe(1)
  })
})

describe('normalizeProjectDir', () => {
  test('one spelling per folder: dots and extra separators collapse, the root stays', () => {
    expect(normalizeProjectDir(' /a/./b/../c//d/ ')).toBe('/a/c/d')
    expect(normalizeProjectDir('/a/b')).toBe(normalizeProjectDir('/a/b/'))
    expect(normalizeProjectDir('/')).toBe('/')
  })
})
