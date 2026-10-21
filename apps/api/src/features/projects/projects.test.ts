import { randomUUID } from 'node:crypto'
import { createChatFeaturePorts } from '../../bootstrap/chat-feature-ports'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { testWork } from '../../testing/work-fixture'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProjectsService } from './service'
import type { Project } from './contracts'
import {
  createTestCatalogService as createCatalogService,
  createTestChatService as createChatService,
} from '../chat/test-harness'
import { createProviderConnectionsService } from '../provider-connections/service'

const tempDir = join(process.cwd(), 'tmp', 'projects-tests')

describe('projects feature', () => {
  let db: any
  let projectsService: any
  let chatService: any

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)

    projectsService = createProjectsService({ db })

    const catalogService = createCatalogService()
    const providerConnectionsService = createProviderConnectionsService({ db })
    chatService = createChatService({
      db,
      work: testWork(db),
      ports: createChatFeaturePorts(db),
      catalogService,
      providerConnectionsService,
    })
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(tempDir, { recursive: true, force: true })
  })

  test('create, list, update, get, delete project', async () => {
    const userId = 'user_p1'

    // 1. The roster is never empty: reading it is also where the default project — the one
    //    an unassigned session lands in — comes into existence.
    const initial = await projectsService.listProjects(userId)
    expect(initial.projects.map((p: Project) => p.isDefault)).toEqual([true])

    // 2. Create project
    const project = await projectsService.createProject(userId, {
      name: 'Test Project',
      workingDir: '/path/to/test-project',
    })
    expect(project.id).toBeDefined()
    expect(project.name).toBe('Test Project')
    expect(project.workingDir).toBe('/path/to/test-project')

    // 3. List contains project
    const list = await projectsService.listProjects(userId)
    expect(list.projects.map((p: Project) => p.id)).toContain(project.id)
    expect(list.projects.find((p: Project) => p.id === project.id)?.isDefault).toBe(false)

    // 4. Get project
    const fetched = await projectsService.getProject(userId, project.id)
    expect(fetched.name).toBe('Test Project')

    // 5. Update project
    const updated = await projectsService.updateProject(userId, project.id, {
      name: 'Updated Name',
      workingDir: '/new/path',
    })
    expect(updated.name).toBe('Updated Name')
    expect(updated.workingDir).toBe('/new/path')

    // 6. Delete project
    await projectsService.deleteProject(userId, project.id)
    const afterDelete = await projectsService.listProjects(userId)
    expect(afterDelete.projects.map((p: Project) => p.id)).not.toContain(project.id)
  })

  /**
   * The default project cannot be deleted, for the same reason the default agent cannot: it
   * is where everything lands when the user picked nothing. The button used to work, and did
   * nothing useful — `resolveDefaultProject` revives the same row on the next session (a
   * second row for that directory would split its capability scope in two), so "deleting" it
   * only made the user's own chats unreachable until something recreated it.
   */
  test('the default project refuses deletion, and a renamed one still refuses', async () => {
    const userId = 'user_default_delete'
    const { projects } = await projectsService.listProjects(userId)
    const fallback = projects.find((project: Project) => project.isDefault)
    expect(fallback).toBeDefined()

    await expect(projectsService.deleteProject(userId, fallback!.id)).rejects.toMatchObject({
      status: 400,
      code: 'project_default',
    })

    // Identity is the DIRECTORY: renaming it does not make it an ordinary project.
    await projectsService.updateProject(userId, fallback!.id, { name: 'Scratch' })
    await expect(projectsService.deleteProject(userId, fallback!.id)).rejects.toMatchObject({
      code: 'project_default',
    })

    // …and an ordinary project is still deletable, so the guard is not a blanket refusal.
    const ordinary = await projectsService.createProject(userId, {
      name: 'Real work',
      workingDir: join(tempDir, 'real-work'),
    })
    await projectsService.deleteProject(userId, ordinary.id)
  })

  test('atomic settings patches preserve unrelated fields and null deletes one field', async () => {
    const userId = 'user_settings_patch'
    const project = await projectsService.createProject(userId, {
      name: 'Patch Project',
      workingDir: '/workspace/patch-project',
    })
    await projectsService.updateProject(userId, project.id, {
      settings: {
        customSystemPrompt: 'Keep changes small.',
        contextExclusions: ['**/.env'],
      },
    })

    await Promise.all([
      projectsService.updateProject(userId, project.id, {
        settingsPatch: { modelId: 'anthropic/opus' },
      }),
      projectsService.updateProject(userId, project.id, {
        settingsPatch: { contextExclusions: ['**/.env', '**/secrets/**'] },
      }),
    ])
    const patched = await projectsService.getProject(userId, project.id)
    expect(patched.settings).toEqual({
      customSystemPrompt: 'Keep changes small.',
      contextExclusions: ['**/.env', '**/secrets/**'],
      modelId: 'anthropic/opus',
    })

    const cleared = await projectsService.updateProject(userId, project.id, {
      settingsPatch: { customSystemPrompt: null },
    })
    expect(cleared.settings).toEqual({
      contextExclusions: ['**/.env', '**/secrets/**'],
      modelId: 'anthropic/opus',
    })
  })

  test('associate session with project', async () => {
    const userId = 'user_p2'

    const project = await projectsService.createProject(userId, {
      name: 'Widget Project',
      workingDir: '/workspace/widget',
    })

    const session = await chatService.createSession(userId, {
      title: 'Chat 1',
      modelId: 'openai/gpt-4',
      projectId: project.id,
    })

    expect(session.projectId).toBe(project.id)

    // Fetch session details and verify project ID
    const fetchedSession = await chatService.getSession(userId, session.id)
    expect(fetchedSession.projectId).toBe(project.id)

    // MOVED, never unset: a session always belongs to a project, so the update takes another
    // project id rather than a null that used to mean "the global capability scope".
    const other = await projectsService.createProject(userId, {
      name: 'Other Project',
      workingDir: '/workspace/other',
    })
    const updatedSession = await chatService.updateSession(userId, session.id, {
      projectId: other.id,
    })
    expect(updatedSession.projectId).toBe(other.id)

    const fetchedSessionAfterUpdate = await chatService.getSession(userId, session.id)
    expect(fetchedSessionAfterUpdate.projectId).toBe(other.id)
  })

  // This endpoint serves the trusted CLI (`localix .`) AND the untrusted `localix://open`
  // URL handler, and cannot tell them apart — so the invariant has to hold here. A project's
  // workingDir is the scope every tool resolves against; `normalizeDir` collapses `..` via
  // `path.normalize` without making the result absolute, so a relative input used to mint a
  // project rooted at a path that means a different directory in every process reading it.
  test('resolveProjectByPath refuses a path that is not absolute', async () => {
    const ownDb = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(ownDb)
    const svc = createProjectsService({ db: ownDb })

    for (const bad of ['../../etc', 'relative/dir', '~/projects', '']) {
      const rejection = await svc
        .resolveProjectByPath('user_abs', bad)
        .then(() => null)
        .catch((error: unknown) => error)
      expect(rejection).toBeInstanceOf(Error)
      expect((rejection as { code?: string }).code).toBe('project_path_not_absolute')
    }
    // Nothing was minted along the way — only the default project the roster read ensures.
    expect((await svc.listProjects('user_abs')).projects.map((p) => p.isDefault)).toEqual([true])
  })

  test('resolveProjectByPath finds-or-creates by directory (idempotent)', async () => {
    // Own DB keeps this idempotency scenario isolated from other project fixtures.
    const ownDb = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(ownDb)
    const svc = createProjectsService({ db: ownDb })
    const userId = 'user_resolve'
    const dir = '/Users/me/work/my-app'

    // First call for an unknown path mints a project named after the basename.
    const first = await svc.resolveProjectByPath(userId, dir)
    expect(first.created).toBe(true)
    expect(first.project.workingDir).toBe(dir)
    expect(first.project.name).toBe('my-app')

    // Second call for the same path (even non-normalized) reuses it — no dupes.
    const again = await svc.resolveProjectByPath(userId, '/Users/me/work/my-app/')
    expect(again.created).toBe(false)
    expect(again.project.id).toBe(first.project.id)

    const list = await svc.listProjects(userId)
    expect(list.projects.filter((p: { workingDir: string }) => p.workingDir === dir)).toHaveLength(
      1,
    )

    await destroyDatabase(ownDb)
  })

  test('resolveProjectByPath is idempotent under CONCURRENT opens of the same new dir', async () => {
    // Two near-simultaneous `localix .` opens of the SAME brand-new directory race
    // the check-then-create (there is no unique index on working_dir). Without a
    // single-flight guard both listProjects()→create() and mint DUPLICATE projects.
    const ownDb = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(ownDb)
    const svc = createProjectsService({ db: ownDb })
    const userId = 'user_resolve_concurrent'
    const dir = '/Users/me/work/concurrent-app'

    const [a, b, c] = await Promise.all([
      svc.resolveProjectByPath(userId, dir),
      svc.resolveProjectByPath(userId, dir + '/'),
      svc.resolveProjectByPath(userId, dir),
    ])

    // All three resolve to the SAME project id, and exactly one reports created.
    expect(b.project.id).toBe(a.project.id)
    expect(c.project.id).toBe(a.project.id)
    expect([a.created, b.created, c.created].filter(Boolean)).toHaveLength(1)

    const list = await svc.listProjects(userId)
    expect(list.projects.filter((p: { workingDir: string }) => p.workingDir === dir)).toHaveLength(
      1,
    )

    await destroyDatabase(ownDb)
  })

  test('resolveProjectByPath opens a FILE via its parent-dir project (localix <file>)', async () => {
    const ownDb = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(ownDb)
    const svc = createProjectsService({ db: ownDb })
    const userId = 'user_resolve_file'

    // A real file on disk so the service stats it as a file (not a dir path).
    const projectDir = join(tempDir, `proj-${randomUUID()}`)
    await mkdir(projectDir, { recursive: true })
    const file = join(projectDir, 'app.ts')
    await writeFile(file, 'export const x = 1\n')

    // Opening the file mints a project for its PARENT dir and hands back the file
    // so the app opens a lightweight editor tab.
    const res = await svc.resolveProjectByPath(userId, file)
    expect(res.created).toBe(true)
    expect(res.project.workingDir).toBe(projectDir)
    expect(res.filePath).toBe(file)

    // Opening the parent dir afterwards reuses the SAME project — a file open and
    // a dir open of the same tree never fork into two projects.
    const dirOpen = await svc.resolveProjectByPath(userId, projectDir)
    expect(dirOpen.created).toBe(false)
    expect(dirOpen.project.id).toBe(res.project.id)
    expect(dirOpen.filePath).toBeNull()

    await destroyDatabase(ownDb)
  })
})
