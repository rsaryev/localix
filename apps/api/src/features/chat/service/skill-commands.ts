import { spawn } from 'node:child_process'
import { errorMessage } from '../../../lib/errors'
import { childEnv } from '../../../lib/login-shell-env'
import { awaitChildGone, releaseChildPipes } from '../../../lib/child-exit'
import { killProcessTree, stillRunning } from '../../agent-core/tools/bash/process-tree'
import { resolveShellConfig } from '../../agent-core/tools/environments/shell'
import { alignToCharBoundary } from '../../agent-core/tools/file/file-utils'

/** Max time a skill preprocessing command may run (10 s). */
const SKILL_CMD_TIMEOUT_MS = 10_000
/** Max output bytes captured per command (32 KB). */
const SKILL_CMD_MAX_BYTES = 32 * 1024
/** Max dynamic shell commands authored into one skill body. */
export const SKILL_CMD_MAX_COUNT = 16
/** Bound simultaneous subprocesses while retaining useful parallel expansion. */
const SKILL_CMD_MAX_CONCURRENCY = 4
/** Max stdout bytes inserted across all commands in one expansion. */
export const SKILL_CMD_TOTAL_MAX_BYTES = 64 * 1024

const SKILL_CMD_COUNT_NOTICE = '[additional shell expansions omitted: command budget reached]'
const SKILL_CMD_OUTPUT_NOTICE = '[shell output truncated: aggregate budget reached]'

interface PlannedSkillCommand {
  command: string
  index: number
}

/**
 * CC `! \`cmd\`` dynamic context injection — runs shell commands embedded in
 * skill content before the model sees it, inserting their stdout output.
 *
 * Recognized forms:
 * - Inline: `` !`cmd` `` when `!` is at line-start or preceded by whitespace
 * - Fenced: `` ```! `` ... `` ``` `` block → run as a shell script
 *
 * Each command runs in `cwd` with a 10 s timeout. Errors produce `[Error: <msg>]`
 * inline so the model is aware of the failure (not silently blank). Output is
 * capped at 32 KB per command to protect context window size.
 *
 * Substitution runs once — output is not re-scanned for further placeholders.
 * Only applied to filesystem skills (`source='file'`) — plugin-bundled skills
 * have already gone through the plugin trust gate.
 *
 * The `shell` frontmatter field selects `bash` (default); `powershell` is not
 * supported off-Windows and falls back to bash (the resolved agent shell, see
 * `agent-core/tools/environments/shell.ts`).
 */
export async function expandSkillContent(
  content: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<string> {
  if (!content.includes('!`') && !content.includes('```!')) return content

  // Walk one RegExp match at a time. Do NOT use `matchAll` OR a global
  // `String.replace` here: the latter's specification also gathers match
  // results before applying replacements. SKILL.md is size-bounded, but a
  // dense body can still contain tens of thousands of tiny embeds, and
  // materializing every RegExpMatchArray defeats the command-count budget
  // before a single process starts.
  let overflowNoticeEmitted = false
  const planned: PlannedSkillCommand[] = []
  let placeholderPrefix = '\u0000LOCALIX_SKILL_COMMAND_'
  while (content.includes(placeholderPrefix)) placeholderPrefix += '_'

  const embedRe = /```!\r?\n([\s\S]*?)\r?\n```|(^|(?<=\s))!`([^`]+)`/gm
  let prepared = ''
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = embedRe.exec(content)) !== null) {
    prepared += content.slice(cursor, match.index)
    cursor = match.index + match[0].length

    if (planned.length < SKILL_CMD_MAX_COUNT) {
      const index = planned.length
      planned.push({ command: match[1] ?? match[3] ?? '', index })
      prepared += `${placeholderPrefix}${index}\u0000`
    } else if (!overflowNoticeEmitted) {
      overflowNoticeEmitted = true
      prepared += SKILL_CMD_COUNT_NOTICE
    }
  }
  prepared += content.slice(cursor)

  if (planned.length === 0) return prepared

  const results = Array.from({ length: planned.length }, () => '')
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(SKILL_CMD_MAX_CONCURRENCY, planned.length) }, async () => {
      while (true) {
        const index = next++
        if (index >= planned.length) return
        results[index] = await runCommand(planned[index].command, cwd, env)
      }
    }),
  )

  // Apply the aggregate cap in authored document order, independent of which
  // concurrent subprocess happened to finish first.
  let remaining = SKILL_CMD_TOTAL_MAX_BYTES
  for (let i = 0; i < results.length; i++) {
    const bytes = Buffer.from(results[i])
    if (bytes.length <= remaining) {
      remaining -= bytes.length
      continue
    }
    results[i] =
      remaining > 0
        ? `${bytes.subarray(0, alignToCharBoundary(bytes, remaining)).toString('utf8')}\n${SKILL_CMD_OUTPUT_NOTICE}`
        : SKILL_CMD_OUTPUT_NOTICE
    remaining = 0
  }

  // Replace all bounded placeholders in ONE pass. Command output is inserted
  // only now, so output containing placeholder-like text is never re-scanned.
  const placeholderRe = new RegExp(`${escapeRegExp(placeholderPrefix)}(\\d+)\\u0000`, 'g')
  return prepared.replace(placeholderRe, (_placeholder, rawIndex: string) => {
    const command = planned[Number(rawIndex)]
    return command ? results[command.index] : ''
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function runCommand(cmd: string, cwd: string, env?: Record<string, string>): Promise<string> {
  try {
    // The resolved agent shell, not a literal `sh`: Windows has no `sh` on PATH, so every
    // `!`cmd`` expansion there came back as a spawn error. A host with no bash throws the
    // resolver's install hint, which the catch below inlines like any other failure.
    const { shell, args } = resolveShellConfig()
    const child = spawn(shell, [...args, cmd], {
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
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let overflowed = false
    let spawnError: unknown

    child.stdout?.on('data', (chunk: Buffer) => {
      if (overflowed) return
      const remaining = SKILL_CMD_MAX_BYTES - stdoutBytes
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining)
        stdout.push(kept)
        stdoutBytes += kept.length
      }
      if (chunk.length > remaining) {
        overflowed = true
        killProcessTree(child.pid, 250, stillRunning(child))
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const remaining = 4 * 1024 - stderrBytes
      if (remaining <= 0) return
      const kept = chunk.subarray(0, remaining)
      stderr.push(kept)
      stderrBytes += kept.length
    })
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

    if (timedOut) return `[Error: command timed out after ${SKILL_CMD_TIMEOUT_MS}ms]`
    if (overflowed) return `[Error: command output exceeded ${SKILL_CMD_MAX_BYTES} bytes]`
    if (spawnError) return `[Error: ${errorMessage(spawnError).slice(0, 200)}]`
    if (code !== 0) {
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      return `[Error: command exited with code ${code ?? 'unknown'}${
        detail ? `: ${detail.slice(0, 160)}` : ''
      }]`
    }
    return Buffer.concat(stdout).toString('utf8').trim()
  } catch (err) {
    const msg = errorMessage(err)
    return `[Error: ${msg.slice(0, 200)}]`
  }
}
