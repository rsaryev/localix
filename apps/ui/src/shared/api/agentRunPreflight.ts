export type AgentRunPreflight = (projectId: string | null | undefined) => Promise<void> | null

let active:
  | {
      owner: symbol
      wait: AgentRunPreflight
    }
  | undefined

/**
 * Install the app-owned persistence barrier that every new agent run must cross.
 * The API layer owns invocation; higher-level settings code owns the policy.
 */
export function registerAgentRunPreflight(wait: AgentRunPreflight): () => void {
  const owner = Symbol('agent-run-preflight')
  active = { owner, wait }
  return () => {
    if (active?.owner === owner) active = undefined
  }
}

/** `null` is the allocation-free fast path when no relevant write is pending. */
export function agentRunPreflight(projectId: string | null | undefined): Promise<void> | null {
  return active?.wait(projectId) ?? null
}
