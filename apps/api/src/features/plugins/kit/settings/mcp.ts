import type { McpSettingsReader } from '../../../mcp/claude-code-settings'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { claudeCodeSettingsEnv, settingsEnvOf } from './env'
import { managedSettingsDir } from './managed'
import { readClaudeSettingsSync } from './read'
import { customizationLocks } from './values'

/** The settings MCP reads, as the kit reads them (`mcp/claude-code-settings.ts`). */
export const mcpSettingsReader: McpSettingsReader = {
  read(input) {
    const settings = readClaudeSettingsSync(input)
    return {
      files: settings.files,
      localRoot: settings.localRoot,
      trusted: settings.trusted,
      mcpLocked: customizationLocks(settings).has('mcp'),
      env: settingsEnvOf(settings),
      managedDir:
        input.managed === null ? null : (input.managed?.dir ?? managedSettingsDir(input.platform)),
    }
  },
  folderEnv: (cwd) => claudeCodeSettingsEnv({ homeDir: claudeCodeHome(), cwd }),
}
