import { afterAll, beforeAll } from 'bun:test'
import { mcpSettingsReader } from '../../plugins/kit/settings/mcp'
import { installMcpSettingsReader } from '../claude-code-settings'

/**
 * The kit-backed Claude Code host `mcp` reads (`claude-code-settings.ts`), installed for the test
 * file that calls this, as boot installs it (`installKitPorts`), and removed after it.
 */
export function withClaudeCodeMcp(): void {
  beforeAll(() => installMcpSettingsReader(mcpSettingsReader))
  afterAll(() => installMcpSettingsReader(undefined))
}
