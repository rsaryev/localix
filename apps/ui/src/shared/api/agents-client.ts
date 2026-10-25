import { assertOk, client, unwrap } from './internal'
import type { AgentSummary, AgentRecordInput } from './contracts'

/** '' / null → no query; otherwise the exact project scope the name lives in. */
const scopeQuery = (projectId: string | null) => (projectId ? { projectId } : {})

/**
 * Managed-Agents registry: the per-record verbs. Listing them and switching one on
 * or off both live on the capability endpoints. Spread into `backendClient`. Nothing
 * is auto-enabled — a created agent is on, an imported or hand-dropped one stays off
 * until toggled. Every per-name call carries the scope, because one name may exist
 * globally AND inside a project.
 */
export const agentsApi = {
  async createAgent(input: AgentRecordInput): Promise<AgentSummary> {
    return unwrap(await client.rpc.agents.$post({ json: input as never }))
  },

  async getAgent(name: string, projectId: string | null): Promise<AgentSummary> {
    return unwrap(
      await client.rpc.agents[':name'].$get({ param: { name }, query: scopeQuery(projectId) }),
    )
  },

  async updateAgent(
    name: string,
    input: AgentRecordInput,
    projectId: string | null,
  ): Promise<AgentSummary> {
    return unwrap(
      await client.rpc.agents[':name'].$put({
        param: { name },
        query: scopeQuery(projectId),
        json: input as never,
      }),
    )
  },

  async deleteAgent(name: string, projectId: string | null): Promise<void> {
    await assertOk(
      await client.rpc.agents[':name'].$delete({ param: { name }, query: scopeQuery(projectId) }),
    )
  },

  async duplicateAgent(
    name: string,
    newName: string,
    projectId: string | null,
  ): Promise<AgentSummary> {
    return unwrap(
      await client.rpc.agents[':name'].duplicate.$post({
        param: { name },
        json: { name: newName, projectId },
      }),
    )
  },
}
