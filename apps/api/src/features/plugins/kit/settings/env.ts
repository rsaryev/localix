import { resolveSettingsEnv } from '@rsaryev/llx-plugin/settings'
import { readClaudeSettingsSync, type ClaudeSettings, type ClaudeSettingsInput } from './read'

/**
 * THE `env` BLOCK OF CLAUDE CODE'S SETTINGS, resolved by the kit (`resolveSettingsEnv`: a higher
 * file wins, a project's or local file's waits for the folder's trust, the variables a repository
 * or any file may not set). Localix serves many folders at once, so it never changes its own
 * environment: a folder's variables go to what a run there starts, and to the `${VAR}` expansion
 * of its MCP servers.
 */
export function settingsEnvOf(settings: ClaudeSettings): Record<string, string> {
  return {
    ...resolveSettingsEnv(settings.layers, {
      isFolderTrusted: () => settings.trusted,
      environment: settings.input.env ?? process.env,
      windows: settings.input.platform === 'win32',
    }).values,
  }
}

const CACHE_MS = 2_000
const cache = new Map<string, { at: number; env: Record<string, string> }>()

/**
 * The `env` of the settings Claude Code reads in `cwd`, read synchronously (the file-based managed
 * policy, not the MDM profile) and kept for two seconds, so the many spawns and connection keys of
 * one run read the disk once. An injected managed source is never cached.
 */
export function claudeCodeSettingsEnv(
  input: ClaudeSettingsInput & { cwd: string },
  now: () => number = Date.now,
): Record<string, string> {
  const key = `${input.homeDir}\0${input.cwd}\0${input.env?.CLAUDE_CONFIG_DIR ?? ''}`
  const hit = cache.get(key)
  if (hit && now() - hit.at < CACHE_MS && input.managed === undefined) return hit.env
  const env = settingsEnvOf(readClaudeSettingsSync(input))
  if (input.managed === undefined) cache.set(key, { at: now(), env })
  return env
}
