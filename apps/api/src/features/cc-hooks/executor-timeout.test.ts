import { describe, expect, test } from 'bun:test'

import type { CcHookHandler, CcHookInput } from './contracts'
import { executeHook } from './executor'

/**
 * A blocking hook holds the TURN, so the executor's wait must be bounded by US.
 *
 * The bug these lock: `runCommandHook` resolved only on `'close'`, which fires only
 * once every inherited stdio descriptor is closed — including the ones a hook's own
 * command handed to whatever it spawned. A hook that leaves something behind (starts
 * a watcher, invokes a tool with a daemon) exits at once while that survivor holds
 * our stdout pipe, so the promise never settled and the turn hung FOREVER — behind a
 * hook timeout that had already fired and SIGKILLed the process. `timeoutMs` bounded
 * the PROCESS, not the WAIT.
 *
 * Measured before the fix: a hook with `timeoutMs: 300` was still un-resolved 8s in.
 */

const input = {
  hook_event_name: 'PreToolUse',
  session_id: 's1',
  cwd: process.cwd(),
} as unknown as CcHookInput

const logger = { warn: () => {}, info: () => {} }

function commandHook(command: string, timeoutMs: number): CcHookHandler {
  return { kind: 'command', source: 'project', command, timeoutMs } as CcHookHandler
}

/** A hook that exits immediately, leaving a daemon holding the stdout pipe for 20 s. */
const DAEMON_HOLDER = 'perl -e "setpgrp; sleep 20" & echo hook-ran; exit 0'
/**
 * The hook's own timeout, and the bound on the wait. Both sit far below the daemon's 20 s, so a
 * pass proves the wait ended on the hook's exit, and far above a loaded machine's spawn time.
 */
const HOOK_TIMEOUT_MS = 15_000
const WAIT_BOUND_MS = 10_000

describe('cc-hook executor: the wait is bounded by the hook, not by what it left behind', () => {
  test('a hook whose leftover daemon holds stdout still resolves — and is NOT lost', async () => {
    const started = Date.now()
    const outcome = await executeHook(
      commandHook(DAEMON_HOLDER, HOOK_TIMEOUT_MS),
      input,
      process.cwd(),
      logger,
      true,
    )
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(WAIT_BOUND_MS) // before the fix: never resolved at all
    // The hook exited 0 in time, so its output is honoured — not discarded as a
    // timeout. (The kill cap must not fire during the drain window.)
    expect(outcome.blocked).toBeUndefined()
    expect(outcome.additionalContext).toContain('hook-ran')
  }, 20_000)

  test('a BLOCKING hook (exit 2) still blocks when a leftover holds the pipe', async () => {
    const outcome = await executeHook(
      commandHook('perl -e "setpgrp; sleep 20" & echo "nope" >&2; exit 2', HOOK_TIMEOUT_MS),
      input,
      process.cwd(),
      logger,
      false,
    )
    expect(outcome.blocked).toBe(true)
    expect(outcome.blockReason).toContain('nope')
  }, 20_000)

  test('a genuinely hung hook is still cut off at its timeout', async () => {
    const started = Date.now()
    const outcome = await executeHook(
      commandHook('sleep 30', 300),
      input,
      process.cwd(),
      logger,
      true,
    )
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(3_000)
    expect(outcome).toEqual({ failed: 'timeout' }) // timed out → non-blocking, ignored
  }, 20_000)

  test('a normal hook is unaffected — settles on close, keeps all its output', async () => {
    const started = Date.now()
    const outcome = await executeHook(
      commandHook('echo one; echo two; exit 0', 5_000),
      input,
      process.cwd(),
      logger,
      true,
    )
    expect(Date.now() - started).toBeLessThan(500) // 'close' wins; no drain spent
    expect(outcome.additionalContext).toContain('one')
    expect(outcome.additionalContext).toContain('two')
  }, 20_000)
})
