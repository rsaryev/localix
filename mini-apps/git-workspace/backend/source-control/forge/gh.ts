/**
 * GitHub forge backend over the `gh` CLI. All wire specifics (command surface +
 * JSON shapes) live here; the port + contracts stay host-neutral. `gh` owns
 * authentication — we never read, store, or pass a token. Every command is an
 * argv array (no shell, no interpolation), so a branch name can never smuggle a
 * flag.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { ForgeBackend } from './ports'
import type { ForgePullRequest } from './contracts'
import { parsePullRequests } from './parse'
import { runGh } from './gh-cli'
import { createGhStatusProbe, type GhStatusProbeOptions } from './gh-status'

/** The `--json` fields we request for each PR (kept in one place). */
const PR_FIELDS = 'number,title,state,headRefName,url,isDraft,author,statusCheckRollup'

const UNAVAILABLE = () =>
  new ApiError(
    409,
    'forge_unavailable',
    'GitHub CLI (gh) is not installed or not signed in. Run `gh auth login`.',
  )

export type GithubForgeOptions = GhStatusProbeOptions

export function createGithubForge(options: GithubForgeOptions = {}): ForgeBackend {
  // Concurrent, single-flight, TTL-cached — see gh-status.ts for why each.
  const status = createGhStatusProbe(options)

  async function listPullRequests(cwd: string): Promise<ForgePullRequest[]> {
    const res = await runGh(cwd, ['pr', 'list', '--json', PR_FIELDS, '--limit', '30'])
    if (!res.ok) return [] // not available / no remote → quiet empty list
    return parsePullRequests(res.stdout)
  }

  async function createPullRequestWeb(cwd: string): Promise<void> {
    const res = await runGh(cwd, ['pr', 'create', '--web'])
    if (res.notFound) throw UNAVAILABLE()
    if (!res.ok) {
      const msg =
        res.stderr
          .split('\n')
          .map((l) => l.trim())
          .find(Boolean) ?? ''
      // gh says this plainly when logged out; map it to the shared typed error.
      if (/auth|logged in|authenticate/i.test(msg)) throw UNAVAILABLE()
      throw new ApiError(
        409,
        'forge_create_pr_failed',
        msg || 'Could not open the pull-request page.',
      )
    }
  }

  async function prDiff(cwd: string, number: number): Promise<string> {
    // Guard the PR number: a positive integer only, passed as its own argv token
    // so it can never smuggle a flag. `gh pr diff <n>` emits the unified patch.
    if (!Number.isInteger(number) || number <= 0) {
      throw new ApiError(400, 'forge_pr_diff_failed', 'Invalid pull-request number.')
    }
    // PR diffs can be slow (a large diff over the network) — allow 30s here.
    const res = await runGh(cwd, ['pr', 'diff', String(number)], 30_000)
    if (res.notFound) throw UNAVAILABLE()
    if (!res.ok) {
      const msg =
        res.stderr
          .split('\n')
          .map((l) => l.trim())
          .find(Boolean) ?? ''
      if (/auth|logged in|authenticate/i.test(msg)) throw UNAVAILABLE()
      throw new ApiError(
        409,
        'forge_pr_diff_failed',
        msg || `Could not load the diff for PR #${number}.`,
      )
    }
    return res.stdout
  }

  return { id: 'github', status, listPullRequests, createPullRequestWeb, prDiff }
}
