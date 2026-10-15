/**
 * Runs `tick` up to `attempts` times, waiting `intervalMs` after every attempt that does not
 * finish (including the last one). The first tick runs immediately. Returns `true` as soon as a
 * tick reports completion and `false` once the attempts are exhausted. Errors thrown by `tick`
 * propagate and stop the loop.
 */
export async function pollAttempts(
  attempts: number,
  intervalMs: number,
  tick: (attempt: number) => Promise<boolean>,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await tick(attempt)) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}
