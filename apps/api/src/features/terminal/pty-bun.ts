/**
 * Local PTY backend built on Bun's native pseudo-terminal support
 * (`Bun.spawn(..., { terminal })` — openpty on POSIX, ConPTY on Windows). No
 * native addon dependency. Satisfies the agnostic {@link PtyBackend} contract.
 */
import type { PtyBackend, PtyHandle, PtySpawnOptions } from './pty-backend'
import { createStreamTextDecoder } from '../../lib/stream-text'
import { isAlive, killProcessTree } from '../../lib/process-tree'
import { trackSpawnedProcess } from '../../lib/orphan-guard'
import { childEnv } from '../../lib/login-shell-env'
import { resolveShellConfig } from '../agent-core/tools/environments/shell'

const KILL_GRACE_MS = 500

/**
 * Whether the PTY's tree is still ours to escalate on, for the shared ladder in
 * `lib/process-tree.ts`. Bun's POSIX terminal child leads its own process group, so the
 * group SIGTERM there reaches grandchildren (dev servers, watchers) that ignore HUP. A shell
 * can exit while a signal-resistant grandchild remains in that group, so its exit alone does
 * not cancel the SIGKILL; the group being GONE when the root exits does — after that the
 * number may be recycled, and the escalation would reach a stranger. (On Windows there are
 * no groups: the probe fails, so an exited root cancels the force `taskkill`, as before.)
 */
export function ptyTreeStillOurs(
  proc: { readonly pid: number; readonly exited: Promise<unknown> },
  groupAlive: (pid: number) => boolean = (pid) => isAlive(-pid),
): () => boolean {
  let gone = false
  const settle = () => {
    if (!groupAlive(proc.pid)) gone = true
  }
  void proc.exited.then(settle, settle)
  return () => !gone
}

const defaultShell = (platform: NodeJS.Platform) =>
  process.env.SHELL || (platform === 'win32' ? 'powershell.exe' : '/bin/bash')

/**
 * Argv for the PTY process: an interactive shell (plus any injected shell args, e.g.
 * `--rcfile`), or a one-shot command.
 *
 * A one-shot command on Windows goes through the resolved agent shell (Git Bash), not
 * `powershell -Command`. The command IS the agent's `bash background:true` text — POSIX
 * syntax, the same string `childBgProc` hands to bash when no terminal host is wired — so
 * PowerShell mistranslated `&&`, `$VAR`, quoting and redirection, and the SAME command
 * behaved differently depending only on whether a pane was visible. Interactive panes keep
 * the user's shell: a person typing into PowerShell is not running agent syntax.
 */
export function ptyArgv(
  options: Pick<PtySpawnOptions, 'shell' | 'command' | 'shellArgs'>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const shell = options.shell || defaultShell(platform)
  if (!options.command) return [shell, ...(options.shellArgs ?? [])]
  if (platform === 'win32') {
    const agent = resolveShellConfig()
    return [agent.shell, ...agent.args, options.command]
  }
  return [shell, '-lc', options.command]
}

/**
 * Tear a PTY down: kill the process tree FIRST, then close the terminal.
 *
 * The reverse order hung on Windows: `ClosePseudoConsole` blocks until every client of the
 * console has exited on builds before Windows 11 24H2, so closing a live pane froze the
 * calling thread — the API's event loop — until the child happened to exit on its own.
 */
export function disposePty(
  proc: { readonly terminal?: Pick<Bun.Terminal, 'close'> },
  killTree: () => void,
): void {
  killTree()
  try {
    proc.terminal?.close()
  } catch {
    /* already closed */
  }
}

export const bunPtyBackend: PtyBackend = {
  spawn(options: PtySpawnOptions): PtyHandle {
    const dataListeners = new Set<(data: string) => void>()
    const exitListeners = new Set<(code: number) => void>()
    // Stateful across chunks: a PTY read splits wherever the OS buffer ended, and
    // a box-drawing character cut in half is what the agent then reads off the
    // screen. See lib/stream-text.ts.
    const decode = createStreamTextDecoder()

    const proc = Bun.spawn(ptyArgv(options), {
      cwd: options.cwd,
      // `childEnv`, the one place child env is built: the repaired login env, and none of
      // the AppImage runtime's library paths (lib/appimage-env.ts) in the user's shell.
      env: childEnv({ TERM: 'xterm-256color', ...options.env }),
      terminal: {
        cols: options.cols,
        rows: options.rows,
        name: 'xterm-256color',
        data: (_t, bytes) => {
          const text = decode(bytes)
          for (const l of dataListeners) l(text)
        },
      },
    })
    let killed = false

    // The shell's own process exit (vs the PTY stream closing) — the authoritative
    // "terminal is done" signal that drives session disposal.
    // Fatal-exit safety net: a PTY shell is its own session leader, so nothing reaches it
    // if the server dies without running its async shutdown (which disposes PTYs properly).
    const untrack = trackSpawnedProcess(proc.pid)
    void proc.exited.then((code) => {
      untrack()
      for (const l of exitListeners) l(code)
    })

    return {
      write: (data) => proc.terminal?.write(data),
      resize: (cols, rows) => proc.terminal?.resize(cols, rows),
      onData: (listener) => {
        dataListeners.add(listener)
      },
      onExit: (listener) => {
        exitListeners.add(listener)
      },
      kill: () => {
        if (killed) return
        killed = true
        disposePty(proc, () => killProcessTree(proc.pid, KILL_GRACE_MS, ptyTreeStillOurs(proc)))
      },
    }
  },
}
