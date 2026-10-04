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
 * The blind-overwrite refusal for the `write` tool, as a guard so it runs in BOTH
 * phases from a SINGLE source of truth:
 *
 * - as a streaming early-guard (the moment `path` has streamed, before the big
 *   `content` body generates — saving the wasted output tokens on a doomed write), and
 * - as a pre-execute guard (the backstop for a call whose args finished streaming
 *   before the early-guard could fire).
 *
 * Overwriting an existing file the agent never read this run silently destroys
 * content. Instead of just refusing, we embed the current content in the error so
 * the model can re-issue the write on its very NEXT call without a separate `read`
 * (mirrors apply_patch's not-found error embedding the real lines). Recording the
 * mtime here is what makes that retry PASS the guard — the model has now genuinely
 * seen the content it is about to replace. Returns undefined (allow) when the file
 * doesn't exist or was already recorded as read this run.
 *
 * The stale-mtime guard (file changed on disk since it was read) is NOT here — it
 * needs the live stat at write time and stays inline in the tool's execute().
 */
export async function evaluateBlindOverwriteGuard(
  env: ExecutionEnvironment,
  input: { path: string; cwd?: string },
  defaultCwd: string | undefined,
  mtimes: FileMtimeStore,
  // `never` states what the verdict actually carries: a BLOCK here is always a bare
  // tool error with no `details`. The bare `GuardVerdict` (= GuardVerdict<unknown>)
  // said the opposite — it claimed the block MIGHT carry arbitrary details, which is
  // why it would not fit a tool that states its own TDetails.
): Promise<GuardVerdict<never>> {
  const target = resolveFileTarget(input.path, input.cwd, defaultCwd)
  const existing = await statIfExists(target.path)
  if (!existing?.isFile()) return undefined
  if (mtimes.has(target.path)) return undefined

  let snapshot = ''
  let truncNote = ''
  let snapshotOk = false
  try {
    const full = await env.readFile(target.path)
    const totalBytes = Buffer.byteLength(full, 'utf8')
    const CAP = 16 * 1024
    if (totalBytes > CAP) {
      const buf = Buffer.from(full, 'utf8')
      snapshot = buf.subarray(0, alignToCharBoundary(buf, CAP)).toString('utf8')
      truncNote = `\n[... truncated: showing first ${CAP} of ${totalBytes} bytes — use read for the rest before overwriting]`
    } else {
      snapshot = full
    }
    await mtimes.recordNow(target.path)
    snapshotOk = true
  } catch {
    // Unreadable (binary/permission) — fall back to the bare guard message.
  }
  const embedded = snapshotOk
    ? `\n\nCurrent content of ${target.path} (${Buffer.byteLength(snapshot, 'utf8')} bytes shown):\n<current_file_content>\n${snapshot}${truncNote}\n</current_file_content>\n\n` +
      'You have now seen the current content. If you still want to replace it, re-issue the SAME write call (it will succeed), or use apply_patch for targeted changes.'
    : ' Read the file first to confirm you want to replace its contents, then re-issue the write (or use apply_patch for targeted changes).'
  return {
    block: true,
    result: buildToolError({
      content: `${target.path} already exists but has not been read this run.` + embedded,
      message: `Refusing blind overwrite of unread file: ${target.path}`,
      userMessage: `Refused to overwrite ${target.path} without reading it first.`,
      retryable: true,
    }),
  }
}
