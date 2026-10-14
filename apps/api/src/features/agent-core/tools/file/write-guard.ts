import type { GuardVerdict } from '@localixai/agent/agents'
import {
  alignToCharBoundary,
  resolveFileTarget,
  statIfExists,
  type FileMtimeStore,
} from './file-utils'
import type { ExecutionEnvironment } from '../environment'
import { buildToolError } from '../tool-errors'

/**
 * The blind-overwrite refusal for the `write` tool, as its pre-execute guard: it runs before
 * the permission gate and before any file of the call is written.
 *
 * Overwriting an existing file the agent never read this run silently destroys content.
 * Instead of just refusing, we embed the current content in the error so the model can
 * re-issue the write on its very NEXT call without a separate `read`. Recording the mtime
 * here is what makes that retry PASS the guard — the model has now genuinely seen the content
 * it is about to replace. Returns undefined (allow) when every target is new or was already
 * recorded as read this run.
 *
 * A batch is judged as ONE call: if any of its files is an unread existing file, nothing is
 * written and the refusal embeds every such file, so the same call re-issued succeeds whole.
 * Refusing per file instead would need the check inside `execute` — after the permission
 * gate, so a person would approve a write that then fails on a precondition the tool could
 * have stated first.
 *
 * Mid-stream: this was also a `streamGuard` that fired the moment a top-level `path` had
 * streamed, before a large `content` body generated. A stream guard names TOP-LEVEL
 * `requiredFields`, and a `files` array is complete only once every body has streamed, so it
 * could no longer save those tokens; it is gone rather than kept as a second copy that fires
 * no earlier than this one.
 *
 * The stale-mtime guard (file changed on disk since it was read) is NOT here — it
 * needs the live stat at write time and stays inline in the tool's execute(), per file.
 */
export async function evaluateBlindOverwriteGuard(
  env: ExecutionEnvironment,
  paths: readonly string[],
  cwd: string | undefined,
  defaultCwd: string | undefined,
  mtimes: FileMtimeStore,
  // `never` states what the verdict actually carries: a BLOCK here is always a bare
  // tool error with no `details`. The bare `GuardVerdict` (= GuardVerdict<unknown>)
  // said the opposite — it claimed the block MIGHT carry arbitrary details, which is
  // why it would not fit a tool that states its own TDetails.
): Promise<GuardVerdict<never>> {
  const blind: string[] = []
  for (const path of paths) {
    const target = resolveFileTarget(path, cwd, defaultCwd).path
    if (blind.includes(target)) continue
    const existing = await statIfExists(target)
    if (existing?.isFile() && !mtimes.has(target)) blind.push(target)
  }
  if (blind.length === 0) return undefined

  const sections: string[] = []
  for (const target of blind) {
    const shown = await snapshotOf(env, target, mtimes)
    if (shown !== undefined) sections.push(shown)
  }
  const names = blind.join(', ')
  const head =
    blind.length === 1
      ? `${names} already exists but has not been read this run.`
      : `${names} already exist but have not been read this run; nothing in this call was written.`
  const shownAll = sections.length === blind.length
  const embedded =
    (sections.length ? `\n\n${sections.join('\n\n')}\n\n` : ' ') +
    (shownAll
      ? 'You have now seen the current content. If you still want to replace it, re-issue the SAME write call (it will succeed), or use edit for targeted changes.'
      : 'Read the file first to confirm you want to replace its contents, then re-issue the write (or use edit for targeted changes).')
  return {
    block: true,
    result: buildToolError({
      content: head + embedded,
      message: `Refusing blind overwrite of unread file: ${names}`,
      userMessage: `Refused to overwrite ${names} without reading ${blind.length === 1 ? 'it' : 'them'} first.`,
      retryable: true,
    }),
  }
}

/** The current content of an unread file, capped, recording it as read; undefined if unreadable. */
async function snapshotOf(
  env: ExecutionEnvironment,
  target: string,
  mtimes: FileMtimeStore,
): Promise<string | undefined> {
  try {
    const full = await env.readFile(target)
    const totalBytes = Buffer.byteLength(full, 'utf8')
    const CAP = 16 * 1024
    let snapshot = full
    let truncNote = ''
    if (totalBytes > CAP) {
      const buf = Buffer.from(full, 'utf8')
      snapshot = buf.subarray(0, alignToCharBoundary(buf, CAP)).toString('utf8')
      truncNote = `\n[... truncated: showing first ${CAP} of ${totalBytes} bytes — use read for the rest before overwriting]`
    }
    await mtimes.recordNow(target)
    return `Current content of ${target} (${Buffer.byteLength(snapshot, 'utf8')} bytes shown):\n<current_file_content>\n${snapshot}${truncNote}\n</current_file_content>`
  } catch {
    // Unreadable (binary/permission) — fall back to the bare guard message.
    return undefined
  }
}
