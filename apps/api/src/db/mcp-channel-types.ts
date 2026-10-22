/** The conversation a Claude Code channel server speaks into (`mcp/channel-binding-repository.ts`). */
export interface McpChannelBindingsTable {
  user_id: string
  server_id: string
  cwd: string
  project_id: string
  /** The gather scope that binds it, so a restart pins the client the way that chat's gather does. */
  scope: string
  session_id: string
  bound_at: string
}
