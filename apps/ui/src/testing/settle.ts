/**
 * Let the screen catch up without a timer: stubbed reads resolve, SWR stores their answers and React
 * renders, over a fixed number of event-loop turns. A turn does not depend on how busy the machine
 * is, so a test that waits this way passes the same alone and in a full parallel run, where a
 * `setTimeout(r, 30)` guesses and sometimes loses (`scripts/test-determinism-guard.test.ts`).
 */

/** `n` event-loop turns, for use inside an `act` the caller already holds. */
export async function turns(n = 12): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** `n` event-loop turns inside React's `act`, so the renders they cause are flushed too. */
export async function settle(n = 12): Promise<void> {
  const { act } = await import('react')
  await act(async () => {
    await turns(n)
  })
}
