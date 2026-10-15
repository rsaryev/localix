export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Poll `check` until it returns a truthy value, or throw once `timeoutMs` has passed. For waiting
 * on something outside this process (another process, a port, a file) that offers no event.
 *
 * @template T
 * @param {string} what Named in the timeout error.
 * @param {() => T | Promise<T>} check
 * @param {number} timeoutMs
 * @param {number} [stepMs]
 * @returns {Promise<T>}
 */
export async function waitFor(what, check, timeoutMs, stepMs = 200) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)
    await sleep(stepMs)
  }
}
