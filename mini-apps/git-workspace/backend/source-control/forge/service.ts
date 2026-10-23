/**
 * Forge orchestration. Host-neutral: it resolves a session's working directory
 * (reusing the source-control cwd resolver so it honours multi-root `repoRoot`)
 * and delegates to the forge backend. Availability failures are reported as flags
 * by `getStatus`, never thrown — the UI stays quiet when gh is absent/unauthed.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { ResolveCwd } from '../ports'
import type { ForgeBackend } from './ports'
import type { ForgePullRequest, ForgeStatus } from './contracts'

export interface ForgeServiceDeps {
  /** Same resolver the source-control service uses (validates `repoRoot`, falls back to primary). */
  resolveCwd: ResolveCwd
  backend: ForgeBackend
}

const unavailable = (forge: ForgeBackend['id']): ForgeStatus => ({
  forge: forge as ForgeStatus['forge'],
  installed: false,
  authed: false,
  hasRemote: false,
  nameWithOwner: null,
})

export interface ForgeService {
  /** Availability of forge features for the session's repo (never throws). */
  getStatus(userId: string, sessionId: string | null, repoRoot?: string): Promise<ForgeStatus>
  /** Open pull requests for the session's repo (empty when unavailable). */
  listPullRequests(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<ForgePullRequest[]>
  /** Open the browser "create PR" flow for the current branch; throws a typed error when gh is unavailable. */
  createPullRequestWeb(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<{ ok: true }>
  /** The unified diff for a pull request; throws a typed error when gh is unavailable. */
  prDiff(
    userId: string,
    sessionId: string | null,
    number: number,
    repoRoot?: string,
  ): Promise<{ diff: string }>
}

export function createForgeService(deps: ForgeServiceDeps): ForgeService {
  return {
    async getStatus(userId, sessionId, repoRoot) {
      const cwd = await deps.resolveCwd(userId, sessionId, repoRoot)
      if (!cwd) return unavailable(deps.backend.id)
      return deps.backend.status(cwd).catch(() => unavailable(deps.backend.id))
    },

    async listPullRequests(userId, sessionId, repoRoot) {
      const cwd = await deps.resolveCwd(userId, sessionId, repoRoot)
      if (!cwd) return []
      return deps.backend.listPullRequests(cwd).catch(() => [])
    },

    async createPullRequestWeb(userId, sessionId, repoRoot) {
      const cwd = await deps.resolveCwd(userId, sessionId, repoRoot)
      if (!cwd) throw new ApiError(404, 'not_a_repo', 'No repository for this session.')
      await deps.backend.createPullRequestWeb(cwd)
      return { ok: true }
    },

    async prDiff(userId, sessionId, number, repoRoot) {
      const cwd = await deps.resolveCwd(userId, sessionId, repoRoot)
      if (!cwd) throw new ApiError(404, 'not_a_repo', 'No repository for this session.')
      return { diff: await deps.backend.prDiff(cwd, number) }
    },
  }
}
