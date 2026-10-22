/** Session E2E: Claude Code plugin MCP servers: stdio and http, names, variables, userConfig, hooks on MCP tools. */
import { CC_MCP_SERVER_SCENARIOS } from './scenarios-cc-mcp-servers.mjs'
import { CC_MCP_HOOK_SCENARIOS } from './scenarios-cc-mcp-hooks.mjs'
import { CC_MCP_STATUS_SCENARIOS } from './scenarios-cc-mcp-status.mjs'

export const CC_MCP_SCENARIOS = [
  ...CC_MCP_SERVER_SCENARIOS,
  ...CC_MCP_HOOK_SCENARIOS,
  ...CC_MCP_STATUS_SCENARIOS,
]
