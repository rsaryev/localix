// Barrel: the MCP "wire" surface is split into focused modules. This file
// preserves the historical `./mcp-wire` import path so client-manager (and
// anything it re-exports to) keeps its exact import surface.
//
//   mcp-connect.ts — transport build + connect (+ connect budget timeout)
//   mcp-result.ts  — MCP multimodal content → AgentToolResult mapping
//   mcp-tools.ts   — tool naming/filtering + buildToolForServer + gather types

export {
  DEFAULT_CONNECT_BUDGET_MS,
  TIMED_OUT,
  withConnectBudget,
  connectClient,
  isMcpAuthenticationRequiredError,
} from './mcp-connect'

export { mapCallResult } from './mcp-result'

export {
  MCP_DESCRIPTION_MAX_CHARS,
  resolveConnectTimeoutMs,
  filterToolDefs,
  modelVisibleToolDefs,
  readMaxResultChars,
  disambiguate,
  namespacedName,
  buildToolForServer,
  type McpGatherResult,
  type McpToolDef,
  type McpClientLike,
  type McpResourceDef,
  type McpResourceTemplateDef,
  type McpResourceContent,
} from './mcp-tools'
