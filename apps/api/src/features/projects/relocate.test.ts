import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { testWork } from '../../testing/work-fixture'
import {
  createTestCatalogService,
  createTestChatService,
  testChatFeaturePorts,
} from '../chat/test-harness'
import { claudeCodeFolderPort } from '../../bootstrap/claude-code-folder'
import { claudeProjectKey, readMemoryIndex, rememberFact } from '../memory/auto-memory'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createProjectsService } from './service'

/**
 * Re-pointing a project at its folder's new place: ONE operation that knows what follows the
 * project (its chats, through `projectId`), what is copied (Claude Code's auto memory, filed by
 * path), and what is never carried (Claude Code's trust in a folder, which is its to give).
 */
const temp = tempDirPerTest('relocate-')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const userId = 'u-relocate'

async function setup() {
  const base = realpathSync(temp())
  const home = join(base, 'home')
  await mkdir(join(home, '.claude'), { recursive: true })
  const from = join(base, 'Documents', 'claude-plugin-kit')
  const to = join(base, 'Documents', 'llx-plugin')
  await mkdir(from, { recursive: true })
  await writeFile(join(from, 'README.md'), 'kit')
  const db = createDatabase({ filename: join(base, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  cleanups.push(() => destroyDatabase(db))
  // The port bootstrap injects, pointed at a temp home.
  const projects = createProjectsService({
    db,
    homeDir: home,
    claudeCode: claudeCodeFolderPort(home),
  })
  const chat = createTestChatService({
    db,
    work: testWork(db),
    ports: testChatFeaturePorts(db),
    catalogService: createTestCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db }),
  })
  const project = await projects.createProject(userId, {
    name: 'claude-plugin-kit',
    workingDir: from,
  })
  const session = await chat.createSession(userId, { title: 'kit', projectId: project.id })
  return { base, home, from, to, db, projects, chat, project, sessionId: session.id }
}

const memoryOf = (home: string, dir: string) =>
  join(home, '.claude', 'projects', claudeProjectKey(dir), 'memory')

describe('relocating a project to its moved folder', () => {
  test('the project and every chat in it work in the new folder, history kept', async () => {
    const { from, to, projects, chat, project, sessionId } = await setup()
    await chat.listDirectory(userId, sessionId)
    await rename(from, to)
    expect(chat.listDirectory(userId, sessionId)).rejects.toMatchObject({
      code: 'workspace_folder_missing',
    })

    const result = await projects.relocateProject(userId, project.id, to)
    expect(result.project).toMatchObject({ id: project.id, workingDir: to })
    expect(await chat.resolveSessionWorkspaceDir(userId, sessionId)).toBe(to)
    const listing = await chat.listDirectory(userId, sessionId)
    expect(listing.entries.map((e) => e.name)).toEqual(['README.md'])
    expect((await chat.getSession(userId, sessionId)).projectId).toBe(project.id)
  })

  test('the old folder’s Claude Code memory is copied; its trust is not', async () => {
    const { home, from, to, projects, project } = await setup()
    await rememberFact(memoryOf(home, from), 'Releases go out on Fridays')
    const state = JSON.stringify({ projects: { [from]: { hasTrustDialogAccepted: true } } })
    await writeFile(join(home, '.claude.json'), state)
    await rename(from, to)

    const result = await projects.relocateProject(userId, project.id, to)
    expect(result.memory).toBe('copied')
    expect((await readMemoryIndex(memoryOf(home, to))).index).toContain('Fridays')
    // Trust is Claude Code's answer about a folder; Localix reads it and never writes it.
    expect(result.trust).toEqual({ before: true, after: false })
    expect(await readFile(join(home, '.claude.json'), 'utf8')).toBe(state)
  })

  test('the same folder again changes nothing', async () => {
    const { from, projects, project } = await setup()
    const result = await projects.relocateProject(userId, project.id, `${from}/`)
    expect(result.project.updatedAt).toBe(project.updatedAt)
    expect(result.memory).toBe('none')
  })

  test('a relative, missing, file, broad or taken folder is refused, the project untouched', async () => {
    const { base, home, from, projects, project } = await setup()
    const other = join(base, 'other')
    await mkdir(other)
    await projects.createProject(userId, { name: 'other', workingDir: other })
    const file = join(base, 'notes.txt')
    await writeFile(file, '')
    const refusal = (to: string) =>
      projects.relocateProject(userId, project.id, to).catch((e: unknown) => e)

    expect(await refusal('Documents/llx-plugin')).toMatchObject({
      status: 400,
      code: 'project_path_not_absolute',
    })
    expect(await refusal(join(base, 'nowhere'))).toMatchObject({
      status: 409,
      code: 'workspace_folder_missing',
    })
    expect(await refusal(file)).toMatchObject({
      status: 409,
      code: 'workspace_folder_not_a_directory',
    })
    expect(await refusal(home)).toMatchObject({ status: 400, code: 'project_folder_broad' })
    expect(await refusal('/')).toMatchObject({ status: 400, code: 'project_folder_broad' })
    expect(await refusal(other)).toMatchObject({ status: 409, code: 'project_folder_taken' })
    expect((await projects.getProject(userId, project.id)).workingDir).toBe(from)
  })

  test('the default project’s folder is not moved', async () => {
    const { base, projects } = await setup()
    const target = join(base, 'elsewhere')
    await mkdir(target)
    const fallback = await projects.defaultProject(userId)
    expect(
      await projects.relocateProject(userId, fallback.id, target).catch((e: unknown) => e),
    ).toMatchObject({ status: 400, code: 'project_default' })
  })
})

describe('a project’s folder status', () => {
  test('present, then missing with the renamed folder offered, then present again', async () => {
    const { from, to, projects, project } = await setup()
    expect(await projects.projectFolder(userId, project.id)).toEqual({
      path: from,
      state: 'present',
      suggestion: null,
    })
    await rename(from, to)
    expect(await projects.projectFolder(userId, project.id)).toEqual({
      path: from,
      state: 'missing',
      suggestion: to,
    })
    await rename(to, from)
    expect((await projects.projectFolder(userId, project.id)).state).toBe('present')
  })

  test('a folder another project already uses is not offered', async () => {
    const { from, to, projects, project } = await setup()
    await projects.projectFolder(userId, project.id)
    await rename(from, to)
    await projects.createProject(userId, { name: 'llx-plugin', workingDir: to })
    expect((await projects.projectFolder(userId, project.id)).suggestion).toBeNull()
  })
})

describe('opening a folder by path', () => {
  test('a live project at the path wins over a deleted one that once had it', async () => {
    const { base, projects } = await setup()
    const dir = join(base, 'shared')
    await mkdir(dir)
    const old = await projects.createProject(userId, { name: 'old', workingDir: dir })
    await projects.deleteProject(userId, old.id)
    const live = await projects.createProject(userId, { name: 'live', workingDir: dir })
    expect((await projects.resolveProjectByPath(userId, dir)).project.id).toBe(live.id)
  })
})
