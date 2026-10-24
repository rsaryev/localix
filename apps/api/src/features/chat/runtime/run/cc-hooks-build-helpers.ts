/** The small pieces `cc-hooks-build.ts` assembles a run's hook runtime from. */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { isPathBelow } from '../../../../lib/path-containment'
import type { CcHookEvent } from '../../../cc-hooks'
import type { RuntimeState } from '../agent-runner-state'
import type { SessionStreamRegistry } from '../session-stream-registry'

// Each of these is a contract, not boilerplate: a second `once` Set would let a `once`
// hook fire twice in one session, and the `hook.notice` shape is read by the UI.

/**
 * Get-or-create a session's `once` tracker in the process-wide map. Keyed PER SESSION so it
 * outlives the per-run runtimes.
 */
export function ensureCcHookOnceKeys(
  ccHookOnceKeys: RuntimeState['ccHookOnceKeys'],
  sessionId: string,
): Set<string> {
  let onceKeys = ccHookOnceKeys.get(sessionId)
  if (!onceKeys) {
    onceKeys = new Set()
    ccHookOnceKeys.set(sessionId, onceKeys)
  }
  return onceKeys
}

/** The instruction files `InstructionsLoaded` reports: every one but an `AGENTS.md`. */
export function instructionFilesForHooks<F extends { path: string }>(
  files: readonly F[] | undefined,
): F[] {
  return (files ?? []).filter((file) => basename(file.path) !== 'AGENTS.md')
}

/** The files under `~/.localix` are the person's own (CC `User`); the rest are the project's. */
export function isUserInstructionFile(path: string): boolean {
  return isPathBelow(join(homedir(), '.localix'), path)
}

/** The console sink `createCcHooksRuntime` logs through (the hook layer prefixes its tags). */
export const ccHooksConsoleLogger = {
  warn: (m: string) => console.warn(m),
  info: (m: string) => console.info(m),
}

/** A hook's non-blocking `systemMessage` → an inline transcript notice on the session's firehose. */
export function ccHookNoticeEmitter(
  streamRegistry: SessionStreamRegistry,
  userId: string,
  sessionId: string,
): (message: string, hookEvent: CcHookEvent) => void {
  return (message, hookEvent) =>
    streamRegistry.publish(userId, sessionId, {
      type: 'hook.notice',
      sessionId,
      message,
      hookEvent,
    })
}
