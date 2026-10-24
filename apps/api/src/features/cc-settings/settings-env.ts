import { isRecord } from '../../lib/record'
import {
  readSettingsFileLayers,
  type SettingsFilesInput,
  type SettingsLayer,
} from './settings-files'
import { claudeCodeTrusts } from './settings-trust'

/**
 * THE `env` BLOCK OF CLAUDE CODE'S SETTINGS (settings-reference.md, `env`): variables Claude Code
 * puts into its environment and so into every process it starts — the Bash tool's commands, hooks,
 * stdio MCP servers. Localix serves many folders at once, so it never changes its own environment;
 * the variables of a folder's settings are handed to what a run there starts, and to the `${VAR}`
 * expansion of its MCP servers.
 *
 * As in Claude Code: a higher file's value wins; a project's or local file's `env` applies once
 * the folder is trusted; those two files cannot set the variables a checked-out repository must
 * not control (where Claude Code keeps its files, telemetry export, how it starts), and no file
 * sets the identity variables Claude Code's host owns.
 */

/** Never from a project or local file ("Variables Claude Code ignores in `env`"). */
const REPOSITORY_FORBIDDEN = new Set([
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_TMPDIR',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'ComSpec',
  'ProgramData',
  'LOCALAPPDATA',
  'PATHEXT',
  'PSModulePath',
  'OTEL_LOG_RAW_API_BODIES',
  'ENABLE_BETA_TRACING_DETAILED',
  'BETA_TRACING_ENDPOINT',
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'CLAUDE_CODE_ENHANCED_TELEMETRY_BETA',
  'ENABLE_ENHANCED_TELEMETRY_BETA',
  'OTEL_LOG_ASSISTANT_RESPONSES',
  'OTEL_EXPORTER_PROMETHEUS_HOST',
  'OTEL_EXPORTER_PROMETHEUS_PORT',
  'CLAUDE_CODE_PROCESS_WRAPPER',
  'CLAUDE_CODE_SYNC_SKILLS',
  'CLAUDE_CODE_SYNC_PLUGINS',
  'CLAUDE_CODE_PLUGIN_CACHE_DIR',
  'CLAUDE_CODE_PLUGIN_SEED_DIR',
  'CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS',
  'CLAUDE_CODE_DISABLE_ATTACHMENTS',
  'CLAUDE_CODE_DISABLE_FILE_MENTIONS',
])
/** Telemetry switches a repository may still turn off, never on. */
const OFF_ONLY: Record<string, (value: string) => boolean> = {
  OTEL_LOGS_EXPORTER: (v) => v === 'none',
  OTEL_METRICS_EXPORTER: (v) => v === 'none',
  OTEL_TRACES_EXPORTER: (v) => v === 'none',
  OTEL_LOG_USER_PROMPTS: (v) => v === '0' || v === 'false',
  OTEL_LOG_TOOL_CONTENT: (v) => v === '0' || v === 'false',
  OTEL_LOG_TOOL_DETAILS: (v) => v === '0' || v === 'false',
}
/** Never from any file: Claude Code's host or launch environment owns them. */
const NEVER = new Set([
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_ACCOUNT_UUID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_PROJECT_DIR_NAME',
  'CLAUDE_CODE_RESTRICTED',
  'CLAUDE_CODE_DISABLE_POWERSHELL_CMD_RM_DENY',
  'CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT',
  'CLAUDE_CODE_DISABLE_SUBSTITUTION_RM_PROMPT',
  'CLAUDE_CODE_DISABLE_INLINE_SHELL_RM_PROMPT',
  'CLAUDE_CODE_DISABLE_MOUNTED_DRIVE_RM_PROMPT',
  'CLAUDE_CODE_WARN_DISK_FREE_GIB',
  'CLAUDE_CODE_WARN_MEMORY_FREE_GIB',
])

function repositoryMaySet(name: string, value: string): boolean {
  if (REPOSITORY_FORBIDDEN.has(name) || name.startsWith('XDG_') || name.startsWith('CLAUDE_AX_'))
    return false
  if (name.startsWith('ProgramFiles')) return false
  if (
    /^OTEL_EXPORTER_OTLP_(.*_)?(ENDPOINT|HEADERS|PROTOCOL|CERTIFICATE|CLIENT_KEY|INSECURE)$/.test(
      name,
    )
  )
    return false
  const offOnly = OFF_ONLY[name]
  return offOnly ? offOnly(value) : true
}

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The merged `env` of the layers, lowest precedence first. */
export function settingsEnvOf(
  layers: readonly SettingsLayer[],
  options: { projectTrusted: boolean },
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const layer of layers) {
    const repository = layer.source === 'project' || layer.source === 'local'
    if (repository && !options.projectTrusted) continue
    if (!isRecord(layer.settings.env)) continue
    for (const [name, raw] of Object.entries(layer.settings.env)) {
      if (!VALID_NAME.test(name) || NEVER.has(name)) continue
      if (raw === null || typeof raw === 'object' || raw === undefined) continue
      const value = String(raw)
      if (repository && !repositoryMaySet(name, value)) continue
      out[name] = value
    }
  }
  return out
}

const CACHE_MS = 2_000
const cache = new Map<string, { at: number; env: Record<string, string> }>()

/**
 * The `env` of the settings Claude Code reads in `cwd`, read synchronously (the file-based
 * managed policy, not the MDM profile) and kept for two seconds, so the many spawns and
 * connection keys of one run read the disk once.
 */
export function claudeCodeSettingsEnv(
  input: SettingsFilesInput & { cwd: string },
  now: () => number = Date.now,
): Record<string, string> {
  const key = `${input.homeDir}\0${input.cwd}\0${input.env?.CLAUDE_CONFIG_DIR ?? ''}`
  const hit = cache.get(key)
  if (hit && now() - hit.at < CACHE_MS && input.managed === undefined) return hit.env
  const env = settingsEnvOf(readSettingsFileLayers(input), {
    projectTrusted: claudeCodeTrusts(input),
  })
  if (input.managed === undefined) cache.set(key, { at: now(), env })
  return env
}

/** A shell script that exports the variables, for a Bash command to source first. */
export function envExportScript(env: Readonly<Record<string, string>>): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
  return Object.entries(env)
    .map(([name, value]) => `export ${name}=${quote(value)}`)
    .join('\n')
}
