/** Normalize a `type: "command"` hook handler: exec form, shell form and the plugin's options. */
import { mkdirSync } from 'node:fs'
import { bindUserConfigInShell, substituteUserConfigInText } from '../ext/user-config-substitute'
import type { CcHookHandler } from './contracts'
import type { SubstOpts } from './config-handler'

/** Data dirs already ensured this process — mkdir once per dir, best-effort. */
const ensuredDataDirs = new Set<string>()

function ensureDataDir(dir: string): void {
  if (ensuredDataDirs.has(dir)) return
  ensuredDataDirs.add(dir)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // best-effort — a hook referencing a dir we can't create still runs
  }
}

/** The variable a plugin option reaches every hook process as: `CLAUDE_PLUGIN_OPTION_<KEY>`. */
export function pluginOptionEnvName(key: string): string {
  return `CLAUDE_PLUGIN_OPTION_${key.toUpperCase().replace(/[^A-Z0-9_]/gu, '_')}`
}

/**
 * Every plugin option, sensitive ones included, as `CLAUDE_PLUGIN_OPTION_<KEY>` (Claude Code
 * exports them to every hook process): the way a shell-form hook reads an option's value.
 */
function pluginOptionEnv(config: SubstOpts['config']): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === undefined || value === null) continue
    env[pluginOptionEnvName(key)] = String(value)
  }
  return env
}

/**
 * Prepare a SHELL-form command, which `sh -c` parses as source: nothing user-controlled is pasted
 * in. `${CLAUDE_PROJECT_DIR}` and the plugin path placeholders are left for the SHELL to expand
 * from the child environment (the executor sets them), and a non-sensitive `${user_config.KEY}`
 * becomes a variable carried in `shellEnv`: a shell never re-parses an expansion, so a project
 * folder named `x$(touch PWNED)` or a config value with a quote stays data. The result is bash
 * syntax; PowerShell reads it through {@link powershellPlaceholders}.
 */
function bindShellCommand(
  command: string,
  opts: SubstOpts,
): Pick<CcHookHandler, 'command'> & {
  bound?: Record<string, string>
} {
  if (!opts.config || !command.includes('${user_config.')) return { command }
  const bound = bindUserConfigInShell(command, opts.config, opts.isSensitive ?? (() => false))
  return Object.keys(bound.env).length > 0
    ? { command: bound.value, bound: bound.env }
    : { command: bound.value }
}

/** A placeholder a shell-form command reads from the child environment, as bash writes it. */
const SHELL_PLACEHOLDER_RE =
  /\$\{(CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|CLAUDE_PLUGIN_OPTION_\w+)(?::-([^}]*))?\}/gu

/**
 * The PowerShell spelling of a shell-form command. {@link bindShellCommand} leaves the path
 * placeholders and the bound options as bash parameter expansions, but in PowerShell
 * `${CLAUDE_PLUGIN_ROOT}` names a PowerShell variable (empty) and `${NAME:-x}` does not parse. Each
 * becomes the environment read `${env:NAME}` — a fallback an `if` subexpression around it — so
 * the value still comes from the child environment and PowerShell, like bash, never re-parses it.
 */
export function powershellPlaceholders(command: string): string {
  return command.replace(SHELL_PLACEHOLDER_RE, (_full, name: string, fallback?: string) => {
    const read = `\${env:${name}}`
    if (fallback === undefined) return read
    return `$(if (${read}) { ${read} } else { '${fallback.replaceAll("'", "''")}' })`
  })
}

/**
 * Substitute placeholders into one EXEC-form string. No shell sees it, so values are pasted as
 * plain text: the path placeholders and, for a plugin hook, every `${user_config.KEY}` — sensitive
 * ones included, as Claude Code does in exec form.
 */
function substituteExec(text: string, opts: SubstOpts): string {
  let out = text.split('${CLAUDE_PROJECT_DIR}').join(opts.projectDir)
  if (opts.pluginRoot) out = out.split('${CLAUDE_PLUGIN_ROOT}').join(opts.pluginRoot)
  if (opts.pluginDataDir) out = out.split('${CLAUDE_PLUGIN_DATA}').join(opts.pluginDataDir)
  if (opts.config && out.includes('${user_config.')) {
    out = substituteUserConfigInText(out, opts.config, () => false).value
  }
  return out
}

/**
 * The spawn fields of a command handler — `command`, exec-form `args`, `shell` and the extra child
 * env — or `undefined` when the entry is unusable (no command, or an `args` that is not a list of
 * strings).
 */
export function commandSpawnFields(
  hRaw: Record<string, unknown>,
  opts: SubstOpts,
): Pick<CcHookHandler, 'command' | 'args' | 'shell' | 'shellEnv'> | undefined {
  if (typeof hRaw.command !== 'string' || !hRaw.command.trim()) return undefined
  const rawArgs = hRaw.args
  if (rawArgs !== undefined && !isStringList(rawArgs)) return undefined
  // Referenced → make sure the dir exists before the hook resolves it.
  const texts = [hRaw.command, ...(rawArgs ?? [])]
  if (opts.pluginDataDir && texts.some((text) => text.includes('CLAUDE_PLUGIN_DATA'))) {
    ensureDataDir(opts.pluginDataDir)
  }
  const optionEnv = pluginOptionEnv(opts.config)
  const withEnv = (bound?: Record<string, string>) => {
    const env = { ...optionEnv, ...bound }
    return Object.keys(env).length > 0 ? { shellEnv: env } : {}
  }
  if (rawArgs) {
    return {
      command: substituteExec(hRaw.command, opts),
      args: rawArgs.map((arg) => substituteExec(arg, opts)),
      ...withEnv(),
    }
  }
  const { command, bound } = bindShellCommand(hRaw.command, opts)
  const shell = hRaw.shell === 'bash' || hRaw.shell === 'powershell' ? hRaw.shell : undefined
  return { command, ...(shell ? { shell } : {}), ...withEnv(bound) }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
