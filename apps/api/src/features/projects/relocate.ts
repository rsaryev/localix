import { homedir } from 'node:os'

import { ConflictError, InvalidRequestError } from '../../lib/domain-errors'
import type { Project } from './contracts'
import { isDefaultProject, normalizeProjectDir } from './default-project'
import { assertAbsolutePath, isBroadDir } from './inspect-path'
import { toDto } from './project-record'
import type { createProjectsRepository, ProjectRecord } from './repository'
import type { ClaudeCodeFolderPort } from './service-deps'
import {
  assertWorkspaceFolder,
  suggestMovedFolder,
  workspaceFolderState,
  type WorkspaceFolderState,
} from './workspace-folder'

/**
 * Re-pointing a project at the folder it moved to: the ONE place that knows what follows.
 *
 *   - Its chats follow by themselves. A session keys on `projectId`, and every cwd (`session-cwd.ts`)
 *     is read from the project at each question, so changing `workingDir` moves the file tree, the
 *     terminal, the language servers, search and the next chat turn together, history kept.
 *   - Rules and settings follow by themselves too: they are filed under the project's id.
 *   - The repository's update announces the project as changed (`project` on the change feed), so
 *     the mini app hosts re-read the folder they serve and every client re-reads its project list;
 *     the live tree watcher moves on the next listing (`fs-watch`: a session whose root changed is
 *     detached from the old one).
 *   - Claude Code's auto memory is filed under the folder's PATH, so it is COPIED to the new path's
 *     folder when that one has none (`carryAutoMemory`, through the injected port). The old copy
 *     stays.
 *   - Claude Code's TRUST in a folder is never carried. It is Claude Code's answer to "may this
 *     folder's hooks, MCP servers and settings run", kept in its own state file, which Localix
 *     reads and never writes. A path is not proof of the same folder (a clone, a download, a new
 *     folder made where the old one was), and even the same folder is not Localix's to vouch for:
 *     Claude Code itself asks again after a move. The answer reports whether the new folder is
 *     trusted, so the client can say why project hooks stopped.
 */

type ProjectsRepository = ReturnType<typeof createProjectsRepository>

export interface RelocateDeps {
  repo: ProjectsRepository
  now: () => string
  /** Claude Code's side of a folder (trust, auto memory); absent, nothing is carried or trusted. */
  claudeCode?: ClaudeCodeFolderPort
  /** The person's home folder, which is too broad to be a project folder. */
  homeDir?: string
}

export interface RelocateResult {
  project: Project
  memory: 'copied' | 'kept' | 'none'
  trust: { before: boolean; after: boolean }
}

export interface ProjectFolder {
  path: string
  state: WorkspaceFolderState
  /** Where the folder went, when that is certain (`suggestMovedFolder`); never applied on its own. */
  suggestion: string | null
}

/** A live project other than `exceptId` that already works in `dir`. */
const projectAt = async (deps: RelocateDeps, userId: string, dir: string, exceptId: string) =>
  (await deps.repo.listProjects(userId)).find(
    (p) => p.id !== exceptId && normalizeProjectDir(p.workingDir) === dir,
  )

export async function relocateProject(
  deps: RelocateDeps,
  project: ProjectRecord,
  inputPath: string,
): Promise<RelocateResult> {
  assertAbsolutePath(inputPath)
  const to = normalizeProjectDir(inputPath)
  const from = normalizeProjectDir(project.workingDir)
  const trusts = (cwd: string) => deps.claudeCode?.trusts(cwd) ?? false
  if (to === from) {
    const trusted = trusts(from)
    return { project: toDto(project), memory: 'none', trust: { before: trusted, after: trusted } }
  }
  if (isDefaultProject(project)) {
    throw new InvalidRequestError(
      'project_default',
      'The default project’s folder cannot be changed: it holds the chats without a project.',
    )
  }
  await assertWorkspaceFolder(to)
  if (isBroadDir(to, deps.homeDir ?? homedir())) {
    throw new InvalidRequestError(
      'project_folder_broad',
      'A disk or the home folder is too broad to be a project folder. Choose the project’s own folder.',
    )
  }
  const taken = await projectAt(deps, project.userId, to, project.id)
  if (taken) {
    throw new ConflictError(
      'project_folder_taken',
      `The project “${taken.name}” already uses this folder.`,
      to,
    )
  }
  const before = trusts(from)
  const updatedAt = deps.now()
  await deps.repo.updateProject(project.userId, project.id, { workingDir: to, updatedAt })
  const memory = (await deps.claudeCode?.carryMemory(from, to)) ?? 'none'
  return {
    project: toDto({ ...project, workingDir: to, updatedAt }),
    memory,
    trust: { before, after: trusts(to) },
  }
}

export async function projectFolder(
  deps: RelocateDeps,
  project: ProjectRecord,
): Promise<ProjectFolder> {
  const path = project.workingDir
  const state = await workspaceFolderState(path)
  const found = state === 'missing' ? await suggestMovedFolder(path) : null
  const suggestion =
    found && !(await projectAt(deps, project.userId, normalizeProjectDir(found), project.id))
      ? found
      : null
  return { path, state, suggestion }
}
