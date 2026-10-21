import { InvalidRequestError, NotFoundError, UnavailableError } from '../../lib/domain-errors'
import path from 'node:path'
import { access, stat } from 'node:fs/promises'
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type {
  CreateProjectRequest,
  ExpandRefsRequest,
  ExpandRefsResponse,
  Project,
  UpdateProjectRequest,
} from './contracts'
import { refKindSpec } from '../chat/context-ref-kinds'
import type { ResourceExpansionResult } from './expand-refs'
import { createUserRefExpander } from './user-ref-expander'
import { createProjectsRepository, type ProjectRecord } from './repository'
import { openDirectory, pickDirectory, pickFiles } from './native-dialogs'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { toDto, applyProjectSettingsPatch } from './project-record'
import { assertProjectDeletable, resolveDefaultProject } from './default-project'
import { assertAbsolutePath, inspectPath, normalizeDir } from './inspect-path'

export { applyProjectSettingsPatch } from './project-record'

export interface ProjectsServiceDeps {
  db: Kysely<AppDatabase>
  now?: () => string
  /** Builds the compact digest for a `@session:<id>` context-ref. Injected by
   *  bootstrap (reads the chat repository) so this feature stays chat-agnostic. */
  loadSessionDigest?: (userId: string, sessionId: string) => Promise<string | null>
  /** Builds the digest for a `@terminal:<id>` context-ref (id or unique prefix).
   *  Injected by bootstrap (reads the live terminal service). */
  loadTerminalDigest?: (userId: string, terminalId: string) => Promise<string | null>
  /** Builds the digest for a `@call:<toolCallId>` context-ref, scoped to the
   *  sending session's transcript. Injected by bootstrap (chat repository). */
  loadCallDigest?: (userId: string, sessionId: string, toolCallId: string) => Promise<string | null>
  /** Builds the digest for a `@project:<id>` context-ref (name, working dir,
   *  session roster). Injected by bootstrap; introspection only, never secrets. */
  loadProjectDigest?: (userId: string, projectId: string) => Promise<string | null>
  /** Builds the digest for a `@message:<sessionId>/<messageId>` context-ref (one
   *  transcript message's role + capped text). Injected by bootstrap. */
  loadMessageDigest?: (
    userId: string,
    sessionId: string,
    messageId: string,
  ) => Promise<string | null>
  /** Resolves a `@resource:<uri>` context-ref via the resource-provider registry.
   *  Injected by bootstrap (registry.expand bound to the user); keeps this feature
   *  free of agent-core/database imports. */
  loadResource?: (
    userId: string,
    uri: string,
    scope?: { sessionId?: string },
  ) => Promise<ResourceExpansionResult>
  /**
   * The directory a session works in, for a user who owns it — REJECTS for a missing or
   * foreign session. Injected by bootstrap (chat's session-cwd seam, which owns the root
   * rule), so this feature never re-derives a sandbox path from an id.
   */
  resolveSessionCwd?: (userId: string, sessionId: string) => Promise<string>
}

export function createProjectsService(deps: ProjectsServiceDeps) {
  const repo = createProjectsRepository(deps.db)
  const now = deps.now ?? (() => new Date().toISOString())
  const serializeUpdate = createKeyedSerializer()

  // Share find-or-create per user and normalized directory: without a unique working_dir
  // index, independent opens could both miss and race to insert. Keep the promise only
  // while creation is in flight. File-opening results remain per caller; followers reuse
  // the project with created: false.
  const resolveInFlight = new Map<string, Promise<{ project: Project; created: boolean }>>()

  const requireProject = async (userId: string, id: string): Promise<ProjectRecord> => {
    const project = await repo.getProject(userId, id)
    if (!project) {
      throw new NotFoundError('project_not_found', 'Project not found')
    }
    return project
  }

  const createProjectFor = async (
    userId: string,
    input: CreateProjectRequest,
  ): Promise<Project> => {
    const timestamp = now()
    const { seq, id } = await repo.allocateProjectRef(userId)
    const record: ProjectRecord = {
      id,
      seq,
      userId,
      name: input.name.trim(),
      workingDir: input.workingDir.trim(),
      settings: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    }
    await repo.insertProject(record)
    return toDto(record)
  }

  const expandRefsWithin = createUserRefExpander(deps)

  return {
    /** The project a session with no explicit one belongs to. See `default-project.ts`. */
    async defaultProject(userId: string): Promise<Project> {
      return toDto(await resolveDefaultProject(repo, userId, now))
    },

    /**
     * Every project, with the default one GUARANTEED to be among them: the workspace has no
     * project-less scope, so an empty roster would leave the client nowhere to land. Uses the
     * same find-or-create a session takes, so the two cannot mint two rows for one directory.
     */
    async listProjects(userId: string): Promise<{ projects: Project[] }> {
      await resolveDefaultProject(repo, userId, now)
      const rows = await repo.listProjects(userId)
      return { projects: rows.map(toDto) }
    },

    async createProject(userId: string, input: CreateProjectRequest): Promise<Project> {
      return createProjectFor(userId, input)
    },

    /**
     * Find-or-create a project for an absolute directory path — the backend of
     * `localix .` / `localix <dir>`. Matches an existing project by its normalized
     * workingDir; otherwise mints one named after the directory's basename. Idempotent:
     * repeated `localix .` in the same directory reuses the same project.
     */
    async resolveProjectByPath(
      userId: string,
      inputPath: string,
    ): Promise<{ project: Project; created: boolean; filePath: string | null }> {
      // A project's workingDir is the scope every tool resolves against, so a RELATIVE one is
      // incoherent for every caller — `localix .` included — not merely unsafe. `normalizeDir`
      // uses `path.normalize`, which collapses `..` without making the result absolute, so
      // without this a `localix://open?path=../../etc` deep link minted a project rooted at a
      // path that means something different in every process that reads it. The grammar in
      // `deepLink.ts` rejects it too; this is the layer that has to hold, because the same
      // endpoint serves the trusted CLI and an untrusted URL handler and cannot tell them apart.
      assertAbsolutePath(inputPath)
      // A FILE input resolves the project from its parent dir and is returned as
      // filePath so the UI opens a lightweight editor tab; a DIRECTORY (or a path
      // that doesn't exist / can't be stat'd) resolves the project directly.
      const normalizedInput = normalizeDir(inputPath)
      let workingDir = normalizedInput
      let filePath: string | null = null
      try {
        if ((await stat(normalizedInput)).isFile()) {
          workingDir = normalizeDir(path.dirname(normalizedInput))
          filePath = normalizedInput
        }
      } catch {
        // Non-existent / unreadable — treat the input as a directory path.
      }

      // A concurrent resolve for the same dir is mid-flight — share its create
      // (this caller only found the project) rather than racing a second one.
      const key = `${userId}\n${workingDir}`
      const inflight = resolveInFlight.get(key)
      if (inflight) return { project: (await inflight).project, created: false, filePath }

      const task = (async (): Promise<{ project: Project; created: boolean }> => {
        // ALL projects, soft-deleted ones included. Re-opening a directory you deleted REVIVES
        // that project rather than minting a second one for the same path: its sessions still
        // point at it (their `project_id` is not nullable) and its capability rules are still
        // filed under its scope, so a fresh row would strand both behind a project the user can
        // no longer see. `created` stays false — the user is coming back to something.
        const rows = await repo.listAllProjects(userId)
        const existing = rows.find((r) => normalizeDir(r.workingDir) === workingDir)
        if (existing) {
          if (existing.deletedAt) await repo.restoreProject(userId, existing.id)
          return { project: toDto({ ...existing, deletedAt: null }), created: false }
        }
        const name = path.basename(workingDir) || workingDir
        return { project: await createProjectFor(userId, { name, workingDir }), created: true }
      })()
      resolveInFlight.set(key, task)
      try {
        const { project, created } = await task
        return { project, created, filePath }
      } finally {
        resolveInFlight.delete(key)
      }
    },

    /** Classify a path as a file or a directory without touching any project (`inspect-path.ts`). */
    inspectPath: (_userId: string, inputPath: string) => inspectPath(inputPath),

    async getProject(userId: string, id: string): Promise<Project> {
      const record = await requireProject(userId, id)
      return toDto(record)
    },

    async updateProject(userId: string, id: string, patch: UpdateProjectRequest): Promise<Project> {
      return serializeUpdate(`${userId}\n${id}`, async () => {
        const existing = await requireProject(userId, id)
        const current = toDto(existing)
        const settings =
          patch.settings !== undefined
            ? patch.settings
            : patch.settingsPatch !== undefined
              ? applyProjectSettingsPatch(current.settings, patch.settingsPatch)
              : undefined
        const updatedAt = now()

        const updateData: Partial<Omit<ProjectRecord, 'id' | 'userId' | 'createdAt'>> = {
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.workingDir !== undefined ? { workingDir: patch.workingDir.trim() } : {}),
          ...(settings !== undefined ? { settings: JSON.stringify(settings) } : {}),
          updatedAt,
        }

        await repo.updateProject(userId, id, updateData)

        return {
          ...current,
          ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
          ...(patch.workingDir !== undefined ? { workingDir: patch.workingDir.trim() } : {}),
          ...(settings !== undefined ? { settings } : {}),
          updatedAt,
        }
      })
    },

    /**
     * SOFT delete — the row, its sessions and its capability scope all stay.
     *
     * A session's `projectId` is not nullable, so a hard delete could only orphan its
     * conversations into the global capability scope (the conflation the default project
     * exists to end) or take them with it. Hiding the project is what "delete" actually means
     * here, and re-opening the same directory brings everything back (`resolveProjectByPath`).
     */
    async deleteProject(userId: string, id: string): Promise<void> {
      assertProjectDeletable(await requireProject(userId, id))
      await repo.deleteProject(userId, id, now())
    },

    /**
     * Expands composer context refs (every kind in the ref-kind registry) against the
     * directory the sending session works in — or, for a composer with no session yet, the
     * project's working dir. Read-only; per-ref errors, never throws.
     *
     * The session's directory is the SERVER's answer (`resolveSessionCwd`: ownership check,
     * then the one session-cwd rule). The client used to send a `rootSessionId` that became
     * `~/.localix/workspace/<id>` with no ownership check, so any caller could read files
     * from another chat's sandbox by naming its root, and a client that computed the root
     * differently from the runtime expanded refs against a directory the agent never sees.
     */
    async expandRefs(userId: string, input: ExpandRefsRequest): Promise<ExpandRefsResponse> {
      let workingDir: string
      if (input.sessionId) {
        if (!deps.resolveSessionCwd)
          throw new UnavailableError('session_scope_unavailable', 'Session scope is not wired')
        workingDir = await deps.resolveSessionCwd(userId, input.sessionId)
      } else if (input.projectId) {
        const project = await requireProject(userId, input.projectId)
        workingDir = project.workingDir
      } else if (input.refs.every((r) => !refKindSpec(r.kind).needsWorkingDir)) {
        // Workdir-free kinds (session/terminal/call/task) resolve via injected
        // loaders, not the filesystem — such a batch needs no directory scope.
        workingDir = ''
      } else {
        throw new InvalidRequestError('missing_scope', 'Either sessionId or projectId is required')
      }
      const expansions = await expandRefsWithin(userId, {
        workingDir,
        refs: input.refs,
        sessionId: input.sessionId ?? undefined,
        sizeOnly: input.sizeOnly ?? false,
      })
      return { workingDir, expansions }
    },

    /**
     * Expand refs against a directory the CALLER already trusts — Context Fabric's host-reference
     * resolver passes the server-minted session workspace. Scope resolution stays in `expandRefs`
     * for the HTTP route; the expansion itself has this one owner.
     */
    expandRefsWithin,

    pickDirectory,
    pickFiles,

    async openProjectDirectory(userId: string, id: string): Promise<{ opened: true }> {
      const project = await requireProject(userId, id)
      try {
        await access(project.workingDir)
      } catch {
        throw new InvalidRequestError(
          'project_directory_not_found',
          'Project folder does not exist',
        )
      }
      return openDirectory(project.workingDir)
    },
  }
}
