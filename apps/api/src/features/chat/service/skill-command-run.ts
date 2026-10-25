import { spawn } from 'node:child_process'
import { errorMessage } from '../../../lib/errors'
import { childEnv } from '../../../lib/login-shell-env'
import { awaitChildGone, releaseChildPipes } from '../../../lib/child-exit'
import { killProcessTree, stillRunning } from '../../agent-core/tools/bash/process-tree'
import { resolveShellConfig } from '../../agent-core/tools/environments/shell'
import { exitOneIsResult } from './skill-command-args'

/**
 * Max time a skill preprocessing command may run: the Bash tool's default of 2 minutes, as Claude
 * Code gives each injected command (skills.md, "How injected commands run"). A timeout aborts the
 * invocation, so a shorter one would fail a setup script Claude Code runs to the end.
 */
const SKILL_CMD_TIMEOUT_MS = 120_000
/** Max output bytes captured per command (32 KB). */
const SKILL_CMD_MAX_BYTES = 32 * 1024
/** What one injected command produced: its output, or why the invocation must stop. */
export type CommandResult = { ok: true; text: string } | { ok: false; output: string }

export async function runCommand(
  cmd: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<CommandResult> {
  try {
    // The resolved agent shell, not a literal `sh`: Windows has no `sh` on PATH, so every
    // `!`cmd`` expansion there came back as a spawn error. A host with no bash throws the
    // resolver's install hint, which the catch below reports like any other failure.
    const { shell, args } = resolveShellConfig()
    // Claude Code: "with the default `bash` shell, Claude Code merges stderr into stdout". In the
    // shell itself, so the two keep their order.
    const child = spawn(shell, [...args, `exec 2>&1\n${cmd}`], {
      cwd,
      // The user's login-shell env (a no-`env` spawn under Bun sees only the
      // process-start snapshot — see login-shell-env.ts) + CC skill env vars.
      env: childEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Make the shell a process-group leader so timeout/overflow/normal-exit
      // cleanup reaches grandchildren and background jobs as one tree.
      detached: process.platform !== 'win32',
      windowsHide: true,
    })
    const output: Buffer[] = []
    let outputBytes = 0
    let timedOut = false
    let overflowed = false
    let spawnError: unknown

    // One bounded buffer for both streams: whatever still reaches stderr (a wrapper shell's own
    // messages) is part of the output too.
    const collect = (chunk: Buffer) => {
      if (overflowed) return
      const remaining = SKILL_CMD_MAX_BYTES - outputBytes
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining)
        output.push(kept)
        outputBytes += kept.length
      }
      if (chunk.length > remaining) {
        overflowed = true
        killProcessTree(child.pid, 250, stillRunning(child))
      }
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', (error) => {
      spawnError = error
    })
    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child.pid, 250, stillRunning(child))
    }, SKILL_CMD_TIMEOUT_MS)
    timer.unref()

    const { code, viaExit } = await awaitChildGone(child, {
      // The process itself met the deadline. Do not let the bounded pipe-drain
      // window relabel a successful exit as a timeout or signal a reused pid.
      onExit: () => clearTimeout(timer),
    })
    clearTimeout(timer)
    // A preprocessing command is never a daemon launcher. Reap anything it
    // backgrounded even after a successful shell exit, then detach inherited
    // pipes held by a descendant that escaped the group.
    killProcessTree(child.pid, 250, stillRunning(child))
    if (viaExit) releaseChildPipes(child)

    const text = Buffer.concat(output).toString('utf8').trim()
    const failed = (reason: string): CommandResult => ({
      ok: false,
      output: text ? `${text}\n[${reason}]` : `[${reason}]`,
    })
    if (timedOut) return failed(`command timed out after ${SKILL_CMD_TIMEOUT_MS}ms`)
    // Too much output is not a failure: the command ran, and its size is reported compactly.
    if (overflowed) {
      return { ok: true, text: `[Error: command output exceeded ${SKILL_CMD_MAX_BYTES} bytes]` }
    }
    if (spawnError) return failed(errorMessage(spawnError).slice(0, 200))
    if (code !== 0 && !(code === 1 && exitOneIsResult(cmd))) {
      return failed(`exit code ${code ?? 'unknown'}`)
    }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, output: `[${errorMessage(err).slice(0, 200)}]` }
  }
}
