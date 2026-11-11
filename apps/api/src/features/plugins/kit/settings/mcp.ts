import type { McpSettingsReader } from '../../../mcp/claude-code-settings'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { claudeCodeSettingsEnv } from './env'
import { claudeCodeMcpPlan } from './mcp-plan'

/** What MCP reads of Claude Code's settings, as the kit decides it (`mcp/claude-code-settings.ts`). */
export const mcpSettingsReader: McpSettingsReader = {
  servers: (input) => claudeCodeMcpPlan(input),
  folderEnv: (cwd) => claudeCodeSettingsEnv({ homeDir: claudeCodeHome(), cwd }),
}
