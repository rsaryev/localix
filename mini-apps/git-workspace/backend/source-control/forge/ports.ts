/**
 * The forge seam. A `ForgeBackend` is one code-host implementation (GitHub over
 * the `gh` CLI today). The forge service depends on this port, never on `gh`
 * directly — a GitLab backend later drops in with zero UI change, mirroring the
 * `SourceControlBackend` / mini app / provider drop-in model.
 */
import type { ForgePullRequest, ForgeStatus } from './contracts'

export interface ForgeBackend {
  /** Stable id surfaced to clients (e.g. `github`). */
  readonly id: string
  /**
   * Availability probe: is the host CLI installed, authed, and does this dir
   * have a forge remote. NEVER throws for the ordinary "not available" cases —
   * it reports them as flags so the UI stays quiet.
   */
  status(cwd: string): Promise<ForgeStatus>
  /** Open pull requests for the repo at `cwd` (newest first). Empty when unavailable. */
  listPullRequests(cwd: string): Promise<ForgePullRequest[]>
  /**
   * Open the "create pull request" flow in the user's browser for the current
   * branch (`gh pr create --web`) — no bespoke form. Throws a typed error when
   * the host CLI is unavailable.
   */
  createPullRequestWeb(cwd: string): Promise<void>
  /**
   * The unified diff text for pull request `number` in the repo at `cwd`
   * (`gh pr diff <n>`). Throws a typed error when the host CLI is unavailable or
   * the diff can't be fetched.
   */
  prDiff(cwd: string, number: number): Promise<string>
}
