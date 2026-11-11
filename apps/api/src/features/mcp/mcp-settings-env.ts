import { claudeCodeMcp, folderSettingsEnv } from './claude-code-settings'
import type { McpServerRecord } from './repository'

/**
 * WHAT A SERVER IS LAUNCHED WITH from a folder: its config expanded against the environment and
 * the `env` of the Claude Code settings Claude Code reads there (`claude-code-settings.ts`),
 * with `CLAUDE_PROJECT_DIR` set to the folder; and, for a stdio server, the environment of its
 * process — the API's, the settings' variables, `CLAUDE_PROJECT_DIR`, then the server's own `env`,
 * which wins. The connection key and the connect read the same answer.
 */
export function mcpLaunch(
  server: McpServerRecord,
  cwd: string,
  settingsEnv: Readonly<Record<string, string>> = folderSettingsEnv(cwd),
): { config: Record<string, unknown>; env: Record<string, string> } {
  const config = claudeCodeMcp().connectConfig(server, {
    ...process.env,
    ...settingsEnv,
    CLAUDE_PROJECT_DIR: cwd,
  })
  const own = (config.env as Record<string, string> | undefined) ?? {}
  return {
    config,
    env: { ...definedOnly(process.env), ...settingsEnv, CLAUDE_PROJECT_DIR: cwd, ...own },
  }
}

function definedOnly(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v
  return out
}
