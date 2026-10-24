import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { envExportScript } from '../../../cc-settings/settings-env'

/**
 * The `env` of Claude Code's settings as a script the Bash tool sources before each command
 * (`BashToolOptions.envScripts`), kept beside the session's `CLAUDE_ENV_FILE`s and rewritten on
 * every run, so an edit to the settings reaches the next run's commands. With no variables the
 * script is removed and nothing is sourced.
 */
export function settingsEnvScriptFor(dir: string, env: Readonly<Record<string, string>>): string[] {
  const file = join(dir, 'claude-settings-env.sh')
  try {
    if (Object.keys(env).length === 0) {
      rmSync(file, { force: true })
      return []
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, `${envExportScript(env)}\n`, { mode: 0o600 })
    return [file]
  } catch {
    // A command still runs without the variables; one that needs them reports it.
    return []
  }
}
