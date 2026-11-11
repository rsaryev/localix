import { installModelAliasResolver } from '../../agent-core/model-alias'
import { installMcpSettingsReader } from '../../mcp/claude-code-settings'
import { modelAliasResolver } from './model-alias'
import { mcpSettingsReader } from './settings/mcp'

/**
 * The Claude Code readings other features take through a port, installed at boot (A4) so they never
 * import the kit: `mcp`'s settings (`mcp/claude-code-settings.ts`) and agent-core's `model:` values
 * (`agent-core/model-alias.ts`).
 */
export function installKitPorts(): void {
  installMcpSettingsReader(mcpSettingsReader)
  installModelAliasResolver(modelAliasResolver)
}
