import { installMcpSettingsReader } from '../../mcp/claude-code-settings'
import { mcpSettingsReader } from './settings/mcp'

/**
 * The Claude Code settings `mcp` reads through a port (`mcp/claude-code-settings.ts`), installed at
 * boot (A4): the boundary imports `mcp`, so `mcp` importing it back would be a feature cycle (A6).
 */
export function installKitPorts(): void {
  installMcpSettingsReader(mcpSettingsReader)
}
