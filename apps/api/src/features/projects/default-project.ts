import path from 'node:path'
import { mkdir } from 'node:fs/promises'

import { ApiError } from '../../lib/errors'
import { localixWorkspaceDir } from '../../lib/env'
import type { ProjectRecord, createProjectsRepository } from './repository'

/**
 * THE project a session belongs to when the user picked none.
 *
 * Every session has a project, and that is not bookkeeping. `capability_rule` stores a scope
 * per project, and "no project" used to resolve to the `global` scope — so switching a tool
 * off in a throwaway chat wrote an installation-wide denial, which composition makes monotone
 * and therefore unremovable from below. A real project gives that chat its own scope and
 * leaves `global` meaning what it says: the ceiling for the whole installation.
 *
 * `~/.localix/workspace` is where project-less sessions already ran, so nothing moves — and it
 * stays the PARENT of their per-session sandboxes rather than becoming a shared cwd. This row
 * answers "which rules apply", not "which directory to work in": one scratch scope you can
 * write a rule in, still a directory per chat (`chat/session-cwd.ts`). A user who wants their
 * files somewhere they own opens a real project.
 *
 * Identity is the DIRECTORY, not the name: find-or-create matches on `workingDir` exactly like
 * `localix .`, so renaming "Default" in the UI keeps it the default rather than minting a
 * second one on the next boot.
 */
export const defaultProjectDir = (): string => localixWorkspaceDir()

export const DEFAULT_PROJECT_NAME = 'Default'

/**
 * Is this THE default project? By its directory, never by its name.
 *
 * The same identity `resolveDefaultProject` finds it by — so a user who renamed "Default" to
 * "Scratch" still has the one project that cannot be deleted, and a user who names a real
 * project "Default" has not accidentally made it undeletable.
 */
export const isDefaultProject = (project: { workingDir: string }): boolean =>
  normalizeProjectDir(project.workingDir) === normalizeProjectDir(defaultProjectDir())

/**
 * Refuse to delete the default project — the same stance the default AGENT takes.
 *
 * It is where everything lands when the user picked nothing, so the system depends on it
 * existing. "Deleting" it never removed anything: `resolveDefaultProject` above revives the
 * same row on the very next session, because a second row for that directory would split its
 * capability scope in two. All the button did was make the user's own chats unreachable until
 * something happened to recreate it.
 *
 * Renaming stays allowed: identity is the directory, not the name.
 */
export function assertProjectDeletable(project: { workingDir: string }): void {
  if (!isDefaultProject(project)) return
  throw new ApiError(
    400,
    'project_default',
    'The default project cannot be deleted — it is where chats without a project live. Rename it, or open a real project instead.',
  )
}

type ProjectsRepository = ReturnType<typeof createProjectsRepository>

/** Path spelling shared with the projects service, so the two cannot miss each other's row. */
export const normalizeProjectDir = (dir: string): string => {
  const normalized = path.normalize(dir.trim())
  return normalized.length > 1 && normalized.endsWith(path.sep)
    ? normalized.slice(0, -1)
    : normalized
}

/**
 * Find-or-create the default project, and return it.
 *
 * Not single-flighted here: the caller that has a serializer uses it, and a genuine interleave
 * collides on the `PRJ-<seq>` primary key rather than duplicating — the same backstop
 * `resolveProjectByPath` relies on.
 */
export async function resolveDefaultProject(
  repo: Pick<
    ProjectsRepository,
    'listAllProjects' | 'allocateProjectRef' | 'insertProject' | 'restoreProject'
  >,
  userId: string,
  now: () => string,
): Promise<ProjectRecord> {
  const workingDir = normalizeProjectDir(defaultProjectDir())
  // ALL projects, deleted ones included: the default project is where an unassigned session
  // lands, so a soft-deleted one must be revived rather than duplicated. Minting a second row
  // for the same directory would split its capability scope in two — the sessions that landed
  // in the first one keep answering to rules the user can no longer see.
  const rows = await repo.listAllProjects(userId)
  const existing = rows.find((row) => normalizeProjectDir(row.workingDir) === workingDir)
  if (existing) {
    if (existing.deletedAt) await repo.restoreProject(userId, existing.id)
    return { ...existing, deletedAt: null }
  }
  // Created before the row so the first run in it finds a real directory, rather than a cwd
  // that only becomes real when some tool happens to write.
  await mkdir(workingDir, { recursive: true })
  const timestamp = now()
  const { seq, id } = await repo.allocateProjectRef(userId)
  const record: ProjectRecord = {
    id,
    seq,
    userId,
    name: DEFAULT_PROJECT_NAME,
    workingDir,
    settings: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
  await repo.insertProject(record)
  return record
}
