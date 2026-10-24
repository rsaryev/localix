import { spawn } from 'node:child_process'
import { errorMessage } from '../../../lib/errors'
import { childEnv } from '../../../lib/login-shell-env'
import { awaitChildGone, releaseChildPipes } from '../../../lib/child-exit'
import { killProcessTree, stillRunning } from '../../agent-core/tools/bash/process-tree'
import { resolveShellConfig } from '../../agent-core/tools/environments/shell'
import { alignToCharBoundary } from '../../agent-core/tools/file/file-utils'
import type { InsertedTextVault } from './inserted-text-vault'
import { bindShellArgs, exitOneIsResult, type SkillShellArgs } from './skill-command-args'

/**
 * Max time a skill preprocessing command may run: the Bash tool's default of 2 minutes, as Claude
 * Code gives each injected command (skills.md, "How injected commands run"). A timeout aborts the
 * invocation, so a shorter one would fail a setup script Claude Code runs to the end.
 */
const SKILL_CMD_TIMEOUT_MS = 120_000
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
  /** The argument values `command` references (see `bindShellArgs`). */
  env: Record<string, string>
  /** The command as a permission rule reads it. */
  display: string
  /** The text as authored (`` !`cmd` `` or the whole ` ```! ` block), named by a failure. */
  pattern: string
  index: number
}

/** What one injected command produced: its output, or why the invocation must stop. */
type CommandResult = { ok: true; text: string } | { ok: false; output: string }

/**
 * Claude Code: "A failed command aborts the entire skill invocation ... Claude never sees the
 * skill content for that invocation. The abort shows `Shell command failed for pattern "..."`.
 * The error message includes the command's output." The caller reports it instead of running.
 */
export class SkillCommandFailedError extends Error {
  readonly pattern: string
  readonly output: string

  constructor(pattern: string, output: string) {
    super(`Shell command failed for pattern "${pattern}"${output ? `: ${output}` : ''}`)
    this.name = 'SkillCommandFailedError'
    this.pattern = pattern
    this.output = output
  }
}

/**
 * Claude Code checks each injected command against the permission rules before any runs; one the
 * rules do not allow aborts the invocation with `Shell command permission check failed for
 * pattern "..."`. A subclass, so every caller that reports a failed command reports this too.
 */
export class SkillCommandPermissionError extends SkillCommandFailedError {
  constructor(pattern: string, reason: string) {
    super(pattern, reason)
    this.message = `Shell command permission check failed for pattern "${pattern}"${reason ? `: ${reason}` : ''}`
    this.name = 'SkillCommandPermissionError'
  }
}

/** Whether an injected command may run: `undefined` allows it, a string is why it may not. */
export type AuthorizeSkillCommand = (command: string) => string | undefined

/**
 * CC `! \`cmd\`` dynamic context injection — runs shell commands embedded in
 * skill content before the model sees it, inserting their stdout output.
 *
 * Recognized forms:
 * - Inline: `` !`cmd` `` when `!` is at line-start or preceded by whitespace
 * - Fenced: `` ```! `` ... `` ``` `` block → run as a shell script
 *
 * Each command runs in `cwd` with a 2-minute timeout (as Claude Code gives it), its stderr merged into its stdout. A command
 * that fails (a non-zero exit other than exit 1 from a search or comparison command, a timeout,
 * a spawn error) throws {@link SkillCommandFailedError}: the whole invocation stops, as in
 * Claude Code. Output is capped at 32 KB per command to protect context window size.
 *
 * `args`, when given, are the invocation's arguments: `$ARGUMENTS`, `$N` and `$name` in a command
 * receive them through environment variables, never as script text (see `bindShellArgs`).
 *
 * `authorize`, when given, is asked about every command before any runs; a refusal throws
 * {@link SkillCommandPermissionError} and nothing runs.
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
  args?: SkillShellArgs,
  authorize?: AuthorizeSkillCommand,
  /** Seals each command's output so later substitutions leave it as printed. */
  vault?: InsertedTextVault,
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
      const authored = match[1] ?? match[3] ?? ''
      const bound = args
        ? bindShellArgs(authored, args)
        : { command: authored, env: {}, display: authored }
      planned.push({ ...bound, pattern: match[0], index })
      prepared += `${placeholderPrefix}${index}\u0000`
    } else if (!overflowNoticeEmitted) {
      overflowNoticeEmitted = true
      prepared += SKILL_CMD_COUNT_NOTICE
    }
  }
  prepared += content.slice(cursor)

  if (planned.length === 0) return prepared
  for (const command of planned) {
    const refusal = authorize?.(command.display)
    if (refusal !== undefined) throw new SkillCommandPermissionError(command.pattern, refusal)
  }

  const outcomes: CommandResult[] = Array.from({ length: planned.length }, () => ({
    ok: true,
    text: '',
  }))
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(SKILL_CMD_MAX_CONCURRENCY, planned.length) }, async () => {
      while (true) {
        const index = next++
        if (index >= planned.length) return
        const command = planned[index]
        outcomes[index] = await runCommand(command.command, cwd, { ...env, ...command.env })
      }
    }),
  )
  // The first failure in document order names the invocation's abort.
  const results = outcomes.map((outcome, i) => {
    if (!outcome.ok) throw new SkillCommandFailedError(planned[i].pattern, outcome.output)
    return outcome.text
  })

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
    const text = command ? results[command.index] : ''
    return vault ? vault.seal(text) : text
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function runCommand(
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
