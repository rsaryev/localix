import type { GuardVerdict } from '@localixai/agent/agents'
import { resolveFileTarget, statIfExists, type FileMtimeStore } from './file-utils'
import { buildToolError } from '../tool-errors'

/**
 * The blind-overwrite refusal for the `write` tool, as its pre-execute guard: it runs before
 * the permission gate and before any file of the call is written.
 *
 * Overwriting an existing file the agent never read this run silently destroys content, so the
 * call is refused and the model is told to `read` the file first. The refusal carries NO file
 * content and records nothing as read: this runs before the permission gate has judged the
 * path, so embedding the file here would let a `write` naming any path (outside the workspace,
 * a credential file) read it with no confirmation. The `read` the model is pointed at goes
 * through the gate like any other read. Returns undefined (allow) when every target is new or
 * was already recorded as read this run.
 *
 * A batch is judged as ONE call: if any of its files is an unread existing file, nothing is
 * written and the refusal names every such file, so the same call re-issued after reading them
 * succeeds whole. Refusing per file instead would need the check inside `execute` — after the
 * permission gate, so a person would approve a write that then fails on a precondition the
 * tool could have stated first.
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

  const names = blind.join(', ')
  const head =
    blind.length === 1
      ? `${names} already exists but has not been read this run.`
      : `${names} already exist but have not been read this run; nothing in this call was written.`
  const them = blind.length === 1 ? 'it' : 'them'
  const hint = ` Use read on ${them} first to confirm you want to replace the contents, then re-issue the write (or use edit for targeted changes).`
  return {
    block: true,
    result: buildToolError({
      content: head + hint,
      message: `Refusing blind overwrite of unread file: ${names}`,
      userMessage: `Refused to overwrite ${names} without reading ${them} first.`,
      retryable: true,
    }),
  }
}
