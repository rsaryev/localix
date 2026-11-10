/** The small pieces `cc-hooks-build.ts` assembles a run's hook runtime from. */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { isPathBelow } from '../../../../lib/path-containment'
import type { SessionStreamRegistry } from '../session-stream-registry'

// The `hook.notice` shape is read by the UI.

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

/** The console sink the run's hook wiring logs through (the transcript, the tool wrapper). */
export const ccHooksConsoleLogger = {
  warn: (m: string) => console.warn(m),
  info: (m: string) => console.info(m),
}

/** A hook's non-blocking `systemMessage` → an inline transcript notice on the session's firehose. */
export function ccHookNoticeEmitter(
  streamRegistry: SessionStreamRegistry,
  userId: string,
  sessionId: string,
): (message: string, hookEvent: string) => void {
  return (message, hookEvent) =>
    streamRegistry.publish(userId, sessionId, {
      type: 'hook.notice',
      sessionId,
      message,
      hookEvent,
    })
}
