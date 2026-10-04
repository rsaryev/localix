import { envString } from '../../../../lib/env'
import { childEnv } from '../../../../lib/login-shell-env'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Cross-platform shell resolution for the agent's command execution.
 *
 * Cross-platform bash discovery for macOS/Linux/Windows: env override first,
 * then /bin/bash → PATH → sh on Unix, and Git Bash / MSYS2 / Cygwin on Windows
 * (via Bun.which / `where.exe` / `which`, plus extra Git install locations).
 *
 * Design decision: on Windows we require a real Windows bash
 * (Git Bash / MSYS2 / Cygwin — not the WSL launcher, whose commands run in a
 * Linux VM that cannot see our cwd or env) and deliberately do NOT fall back to PowerShell or
 * cmd.exe. The agent's system prompt emits POSIX/bash syntax, so a non-bash
 * shell would mistranslate almost every command — a worse experience than a
 * clear "install Git for Windows" error.
 */

export interface ShellConfig {
  /** Absolute path to (or bare name of) the shell binary. */
  shell: string
  /** Args that precede the command string, e.g. `['-c']`. */
  args: string[]
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Locate an executable on PATH, cross-platform — the server's ONE lookup (the shell resolver here
 * and the LSP `which` memo both use it). `Bun.which` resolves `.exe`/`.cmd` on Windows natively.
 *
 * It searches the PATH of `env` — by default `childEnv()`, the login-shell-repaired environment
 * every spawn receives — never the ambient `process.env.PATH`. Under a GUI launch the ambient PATH
 * is launchd's bare one until the login env is folded in, so a lookup against it misses binaries
 * the spawned child would find; the two copies this replaced asked the ambient PATH first and then
 * forked `which`/`where` (about a millisecond of blocked event loop per miss) to ask again with the
 * right one. Asking the right PATH once needs no fork.
 */
export function whichBinary(cmd: string, env: NodeJS.ProcessEnv = childEnv()): string | undefined {
  return Bun.which(cmd, { PATH: pathOf(env) }) ?? undefined
}

/** `PATH` of an env copy; Windows spells it `Path`, and a spread copy loses case-insensitivity. */
function pathOf(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH')
  return (key && env[key]) || ''
}

/** Git-for-Windows install roots to probe, relative to the OS dir vars that name them. */
const WINDOWS_GIT_BASH_PATHS: Array<[envVar: string, segments: string[]]> = [
  ['ProgramFiles', ['Git', 'bin', 'bash.exe']],
  ['ProgramFiles(x86)', ['Git', 'bin', 'bash.exe']],
  ['LOCALAPPDATA', ['Programs', 'Git', 'bin', 'bash.exe']],
]

/**
 * Is this `bash.exe` the WSL launcher rather than a Windows bash?
 *
 * `C:\Windows\System32\bash.exe` (and the `WindowsApps` execution alias) is on every PATH
 * where WSL is installed, and it is usually the FIRST `bash` there, because Git for Windows
 * puts only its `cmd\` directory on PATH. Picked up, it runs the command inside a Linux VM:
 * the Windows cwd does not exist there, the environment we pass never arrives, and every
 * `C:\...` path the agent was given is meaningless — or, with no distro installed, it just
 * prints an install prompt. So it is rejected here and Git Bash is looked for instead.
 */
export function isWslLauncher(candidate: string): boolean {
  const p = candidate.replaceAll('/', '\\').toLowerCase()
  return (
    /\\windows\\(?:system32|syswow64|sysnative)\\bash\.exe$/.test(p) ||
    p.endsWith('\\microsoft\\windowsapps\\bash.exe')
  )
}

/**
 * The `bin\bash.exe` of the Git for Windows install that owns this `git.exe`.
 *
 * Git for Windows' default PATH entry is `<root>\cmd\git.exe`, which never names bash, so a
 * custom install root (scoop, a portable Git, a non-default drive) was invisible to both the
 * PATH lookup and the fixed install locations below. The install layout is fixed, so the
 * owning root is recoverable from any of the three places `git.exe` lives.
 */
export function gitBashForGitExe(gitExe: string): string | undefined {
  const win = path.win32
  const dir = win.dirname(gitExe)
  const leaf = win.basename(dir).toLowerCase()
  const parent = win.dirname(dir)
  const root =
    leaf === 'cmd' || leaf === 'bin'
      ? win.basename(parent).toLowerCase() === 'mingw64'
        ? win.dirname(parent)
        : parent
      : undefined
  return root ? win.join(root, 'bin', 'bash.exe') : undefined
}

function findBash(): string {
  // `envString` treats a BLANK var as unset, so `LOCALIX_SHELL=` falls through to
  // the next candidate instead of resolving to '' — the same rule every other
  // Localix var follows (lib/env.ts).
  const override = envString('LOCALIX_SHELL') ?? envString('LOCALIX_BASH_PATH')
  if (override && isFile(override)) return override

  if (process.platform !== 'win32') {
    return (
      whichBinary('bash') ??
      (isFile('/bin/bash') ? '/bin/bash' : undefined) ??
      (isFile('/usr/bin/bash') ? '/usr/bin/bash' : undefined) ??
      envString('SHELL') ??
      'sh'
    )
  }

  // Windows: resolve a real bash. Prefer one already on PATH (Git Bash, MSYS2,
  // Cygwin — never the WSL launcher, see isWslLauncher), then the bash of the Git
  // that IS on PATH, then the standard Git for Windows install locations.
  const onPath = whichBinary('bash.exe') ?? whichBinary('bash')
  if (onPath && !isWslLauncher(onPath) && isFile(onPath)) return onPath

  const git = whichBinary('git.exe') ?? whichBinary('git')
  const besideGit = git ? gitBashForGitExe(git) : undefined
  if (besideGit && isFile(besideGit)) return besideGit

  for (const [envVar, segments] of WINDOWS_GIT_BASH_PATHS) {
    const root = envString(envVar)
    if (root && isFile(path.join(root, ...segments))) return path.join(root, ...segments)
  }

  throw new Error(
    'No bash shell found. Localix runs agent commands through bash.\n' +
      'On Windows, install Git for Windows (https://git-scm.com/download/win) ' +
      'or set the LOCALIX_SHELL environment variable to your bash.exe path.',
  )
}

let cached: ShellConfig | undefined

/**
 * Resolve the shell to spawn commands with. Result is memoized — shell location
 * does not change within a process. Call `resetShellConfigCache()` in tests that
 * mutate PATH / env between cases.
 */
export function resolveShellConfig(): ShellConfig {
  if (cached) return cached
  cached = { shell: findBash(), args: ['-c'] }
  return cached
}

/** Test seam: drop the memoized shell so a changed env/PATH is re-resolved. */
export function resetShellConfigCache(): void {
  cached = undefined
}
