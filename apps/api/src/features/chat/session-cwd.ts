/**
 * Single source of truth for a session's base filesystem working directory.
 *
 * Two call-sites used to duplicate this resolution and were REQUIRED to agree:
 *   - the agent run path (`runtime/prompt-context.ts` → `defaultCwd`)
 *   - the platform path (`service/session-workspace.ts` → `resolveSessionWorkingDir`,
 *     which feeds SCM, terminal and the file browser).
 *
 * Both now delegate here, so there is exactly ONE seam. The base rule:
 *   a project the user chose → `project.workingDir`, shared by its sessions
 *   otherwise                → the session sandbox `~/.localix/workspace/{rootId}` (mkdir'd)
 *
 * "Otherwise" is the DEFAULT project and the two degenerate cases (a host that wires no
 * project port, a record whose project row has gone). The default project exists so that a
 * chat the user never filed has a capability scope of its own — rules need somewhere to
 * live that is not `global`. That is a question about RULES, and it is not the same
 * question as which directory the agent works in: letting every unfiled chat share one
 * directory turns it into a landfill nobody owns (a thousand sessions, one folder), which
 * is what a session sandbox already solved. So the default project's `workingDir` is the
 * PARENT of those sandboxes rather than the cwd itself: one scope, a directory per chat.
 *
 * A real project is the opposite case and stays shared — its sessions are meant to see each
 * other's work, because they are all working on that repository.
 *
 * One answer, shared by the agent run, the SCM tab, the terminal and the file browser, so a
 * session is rooted in the same place everywhere rather than in some places.
 */
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { localixHome } from '../../lib/env'
import { defaultProjectDir, normalizeProjectDir } from '../projects/default-project'

/** Minimal session shape the cwd resolver needs (a row from the sessions table). */
export interface BaseCwdSession {
  id: string
  projectId: string | null
  rootSessionId: string | null
}

export interface BaseCwdDeps {
  /** Resolve a project's working dir, or null when no/unknown project. */
  getProjectWorkingDir: (userId: string, projectId: string | null) => Promise<string | null>
}

/**
 * The ONE adapter from the projects repository to {@link BaseCwdDeps}'s project
 * port. Every caller that resolves a session cwd from live repositories (the run
 * path, the platform path, the manual-compact hook path) needs exactly this
 * lookup; written out per call-site it is duplicated knowledge that silently
 * agrees — and a project whose working dir is absent must read as "no project
 * dir", not as an empty string.
 */
export function projectWorkingDirPort(projectsRepo: {
  getProject: (
    userId: string,
    projectId: string,
  ) => Promise<{ workingDir: string | null } | null | undefined>
}): BaseCwdDeps['getProjectWorkingDir'] {
  return async (userId, projectId) => {
    if (!projectId) return null
    const project = await projectsRepo.getProject(userId, projectId)
    return project?.workingDir ?? null
  }
}

/**
 * The session sandbox directory: `~/.localix/workspace/{rootId}`.
 *
 * Keyed on the ROOT session, so a delegated child, a delegated task run and a fork all work
 * beside the chat that spawned them rather than each in a directory of its own — the same
 * rule a project scope follows, one level down.
 */
export function sandboxCwd(session: BaseCwdSession): string {
  const rootId = session.rootSessionId ?? session.id
  return path.join(localixHome(), 'workspace', rootId)
}

/**
 * Is this working dir the default project's — i.e. the scratch PARENT, not a cwd?
 *
 * Compares directories, exactly as `resolveDefaultProject` matches its row: renaming
 * "Default" in the UI must not change which project this is.
 */
function isScratchParent(workingDir: string): boolean {
  return normalizeProjectDir(workingDir) === normalizeProjectDir(defaultProjectDir())
}

/**
 * Resolve the directory a session's operations are rooted at.
 *
 * A chosen project's working dir, otherwise the session sandbox — created on demand, so a
 * caller arriving before the first run still sees a real directory.
 * Never returns the filesystem root or process.cwd().
 */
export async function resolveBaseSessionCwd(
  deps: BaseCwdDeps,
  userId: string,
  session: BaseCwdSession,
): Promise<string> {
  const projectDir = await deps.getProjectWorkingDir(userId, session.projectId)
  if (projectDir && !isScratchParent(projectDir)) return projectDir

  const baseCwd = sandboxCwd(session)
  await mkdir(baseCwd, { recursive: true }).catch(() => {})
  return baseCwd
}

/**
 * Delete a session's sandbox when the session itself is deleted.
 *
 * A scratch directory has exactly one owner — the chat it was made for — so it goes when
 * that chat does. Without this the landfill comes back by another door: the sessions are
 * gone from the sidebar and their directories are not.
 *
 * Three refusals, all load-bearing:
 *   • a chosen project's working dir is the USER's directory, never ours to remove;
 *   • a sub-session (worker, fork, delegated child) shares the root's directory, so
 *     deleting one must not take the tree's workspace with it;
 *   • anything that is not a direct child of `~/.localix/workspace` — a computed path that
 *     escaped its parent is a bug, and `rm -r` is the wrong place to find out.
 *
 * Best-effort: a directory that will not delete (open handle, permissions) must not fail
 * the deletion of the session itself.
 */
export async function discardSessionSandbox(
  deps: BaseCwdDeps,
  userId: string,
  session: BaseCwdSession,
): Promise<void> {
  if (session.rootSessionId && session.rootSessionId !== session.id) return
  const projectDir = await deps.getProjectWorkingDir(userId, session.projectId)
  if (projectDir && !isScratchParent(projectDir)) return

  const dir = sandboxCwd(session)
  const parent = path.join(localixHome(), 'workspace')
  if (dir === parent || path.dirname(dir) !== parent) return
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}
