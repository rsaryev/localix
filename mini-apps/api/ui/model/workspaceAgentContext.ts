export interface ApiWorkspaceAgentState {
  requestsLoading: boolean
  requestsError: string | null
  requestCount: number
  selectedRequest?: string
  managingEnvironments: boolean
  environmentsLoading: boolean
  activeEnvironment?: string
}

/** Dynamic state only; stable api_client guidance comes from work-item registration metadata. */
export function apiWorkspaceAgentStateContent(state: ApiWorkspaceAgentState): string {
  const countLine = state.requestsLoading
    ? 'Saved requests: loading (no request snapshot yet).'
    : state.requestsError
      ? `Saved requests: unavailable (${state.requestsError}).`
      : state.requestCount === 0
        ? 'Saved requests: No saved requests.'
        : `Saved requests: ${state.requestCount}.`
  const selectedLine = state.managingEnvironments
    ? 'Current level: environment management.'
    : state.selectedRequest
      ? `Current level: selected request "${state.selectedRequest}".`
      : 'Current level: API workspace root; no request selected.'
  const environmentLine = state.environmentsLoading
    ? 'Active environment: loading.'
    : state.activeEnvironment
      ? `Active environment: ${state.activeEnvironment}.`
      : 'Active environment: none (literal URLs only).'
  return ['Active mini app work item: API Client', countLine, selectedLine, environmentLine].join(
    '\n',
  )
}
