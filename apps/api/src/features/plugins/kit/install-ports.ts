import { installMemoryRuleReader } from '../../agent-core/context-rules'
import { installMcpSettingsReader } from '../../mcp/claude-code-settings'
import { memoryRuleReader } from './memory-rules'
import { mcpSettingsReader } from './settings/mcp'

/**
 * The kit-backed readers a feature takes through a port, installed at boot (A4): the boundary
 * imports `mcp` and `agent-core`, so either importing it back would be a feature cycle (A6). The
 * Claude Code settings `mcp` reads (`mcp/claude-code-settings.ts`); what a memory rule means
 * (`agent-core/context-rules.ts`).
 */
export function installKitPorts(): void {
  installMcpSettingsReader(mcpSettingsReader)
  installMemoryRuleReader(memoryRuleReader)
}
