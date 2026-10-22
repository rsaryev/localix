import { resolveShellConfig, type ShellConfig } from '../agent-core/tools/environments/shell'

/** A command hook's `shell` field (Claude Code): `bash` by default, or `powershell`. */
export type HookShell = 'bash' | 'powershell'

/** What a hook command spawns: an executable and its argument vector, never re-parsed. */
export interface HookSpawnTarget {
  file: string
  argv: string[]
}

export interface HookTargetSpec {
  command: string
  /** Exec form: `command` is the executable and these are its arguments, with no shell. */
  args?: readonly string[]
  shell?: HookShell
  /**
   * Shell form only: the command as PowerShell must read it, applied whenever PowerShell runs it
   * (`shell: "powershell"`, or Windows without bash). The caller owns its placeholder syntax.
   */
  forPowerShell?: (command: string) => string
}

export interface HookTargetHost {
  platform?: NodeJS.Platform
  resolveBash?: () => ShellConfig
}

const POWERSHELL_FLAGS = ['-NoProfile', '-NonInteractive', '-Command']

function powershell(platform: NodeJS.Platform, command: string): HookSpawnTarget {
  // Windows PowerShell ships with every Windows; elsewhere PowerShell is `pwsh`.
  return {
    file: platform === 'win32' ? 'powershell.exe' : 'pwsh',
    argv: [...POWERSHELL_FLAGS, command],
  }
}

/**
 * Claude Code's two command forms. Exec form (`args` present) spawns `command` directly with
 * `args` as the argument vector: no shell tokenizes, expands or globs anything, on any platform,
 * and `shell` is ignored. Shell form passes `command` to bash (`sh -c` semantics; Git Bash on
 * Windows), to PowerShell when `shell` is `"powershell"`, and to PowerShell on Windows when no
 * bash is installed. Throws only when no shell can be resolved at all.
 */
export function resolveHookSpawnTarget(
  spec: HookTargetSpec,
  host: HookTargetHost = {},
): HookSpawnTarget {
  if (spec.args) return { file: spec.command, argv: [...spec.args] }
  const platform = host.platform ?? process.platform
  const psCommand = () => (spec.forPowerShell ? spec.forPowerShell(spec.command) : spec.command)
  if (spec.shell === 'powershell') return powershell(platform, psCommand())
  try {
    const { shell, args } = (host.resolveBash ?? resolveShellConfig)()
    return { file: shell, argv: [...args, spec.command] }
  } catch (error) {
    if (platform === 'win32') return powershell(platform, psCommand())
    throw error
  }
}
