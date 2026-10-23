/**
 * Forge (GitHub over the `gh` CLI): the availability probe, open pull requests,
 * a PR's diff, and the browser create-PR flow. Host-neutral by shape; only
 * GitHub is wired today. Kept apart from the git calls because it is a different
 * system — it can be absent (no `gh`, not authenticated) without the git side
 * being any less available.
 */
import { cleanMiniAppQuery, unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui'
import type { ForgePullRequest, ForgeStatus } from '../../backend/source-control/forge/contracts'
import { client } from './client'

export const forgeApi = {
  // --- Forge (GitHub over `gh`) -----------------------------------------------

  /** Availability of forge (GitHub CLI) features for the session's repo. Never throws server-side. */
  async getForgeStatus(sessionId: string, repoRoot?: string): Promise<ForgeStatus> {
    return unwrapMiniAppResponse<ForgeStatus>(
      await client.rpc['source-control'].forge.status.$get({
        query: cleanMiniAppQuery({ sessionId, repoRoot }),
      }),
    )
  },

  /** Open pull requests for the session's repo (empty when gh is unavailable). */
  async listPullRequests(sessionId: string, repoRoot?: string): Promise<ForgePullRequest[]> {
    const json = await unwrapMiniAppResponse<{ prs: ForgePullRequest[] }>(
      await client.rpc['source-control'].forge.prs.$get({
        query: cleanMiniAppQuery({ sessionId, repoRoot }),
      }),
    )
    return json.prs
  },

  /** Open the browser "create pull request" flow for the current branch (`gh pr create --web`). */
  async createPullRequest(sessionId: string, repoRoot?: string): Promise<{ ok: true }> {
    return unwrapMiniAppResponse<{ ok: true }>(
      await client.rpc['source-control'].forge['create-pr'].$post({
        json: { sessionId, repoRoot },
      }),
    )
  },

  /** The unified diff text for a pull request (`gh pr diff <n>`). */
  async getPrDiff(sessionId: string, number: number, repoRoot?: string): Promise<{ diff: string }> {
    return unwrapMiniAppResponse<{ diff: string }>(
      // `number` is required by the route schema, so build the query as a typed literal.
      await client.rpc['source-control'].forge['pr-diff'].$get({
        query: { sessionId, number: String(number), ...(repoRoot ? { repoRoot } : {}) },
      }),
    )
  },
}
