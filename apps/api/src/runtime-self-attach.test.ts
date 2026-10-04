import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const INDEX = readFileSync(resolve(import.meta.dir, 'index.ts'), 'utf8')

/**
 * The dev-reload deadlock, guarded where the decision is made.
 *
 * `bun --watch` re-evaluates this entry inside the SAME process. The reloaded module then finds a
 * descriptor whose pid is alive — it is us — and whose `/health` still answers for a beat, because
 * the outgoing server has not finished closing. It attached to that endpoint (`owned: false`,
 * `stop()` a no-op), started no server of its own, and moments later the outgoing one was gone:
 * process up, port empty, nothing logged, and only a full restart recovering it.
 *
 * The other half is `stopRuntime`, which on the same descriptor SIGTERMs us and waits fifteen
 * seconds for ourselves to die.
 *
 * The fix is that both decision points ask `isOwnDescriptor` first. That is a structural claim —
 * which call sites consult the guard — so it is asserted on the source, the way this repository
 * asserts its other structural rules. It deliberately does NOT live inside
 * `discoverRuntimeEndpoint`: that helper also answers "wait until the runtime is up" for callers
 * legitimately waiting on their own process, and guarding it there broke exactly those tests.
 */
describe('a watch reload must not attach to its own outgoing runtime', () => {
  const uses = (needle: string) => INDEX.includes(needle)

  test('both discovery call sites route through the guard', () => {
    const guarded = INDEX.match(/isOwnDescriptor\((discovered|found)\) \? null : \1/g) ?? []

    expect(guarded).toHaveLength(2)
  })

  test('neither call site uses a raw discovery result', () => {
    // The shape that broke: `const existing = await discoverRuntimeEndpoint()`, then attach or stop.
    expect(uses('const existing = await discoverRuntimeEndpoint()')).toBe(false)
  })

  test('the guard compares against this process', () => {
    expect(uses('return endpoint?.pid === process.pid')).toBe(true)
  })

  test('the patterns match a real occurrence — otherwise the checks above are vacuous', () => {
    // Positive control: a regex that stopped matching would report a guarded entry either way.
    expect(
      /isOwnDescriptor\((discovered|found)\) \? null : \1/.test(
        'x = isOwnDescriptor(found) ? null : found',
      ),
    ).toBe(true)
    expect(
      /isOwnDescriptor\((discovered|found)\) \? null : \1/.test(
        'isOwnDescriptor(other) ? null : other',
      ),
    ).toBe(false)
  })
})
