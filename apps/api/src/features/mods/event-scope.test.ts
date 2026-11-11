import { expect, test } from 'bun:test'
import { fireIn } from './event-scope'
import { hostWithMod } from './testing/testing-host'

test('an event abandoned while a hook held it runs nothing of Localix’s, though the hook then failed', async () => {
  const stop = new AbortController()
  let holding: () => void = () => {}
  const held = new Promise<void>((resolve) => (holding = resolve))
  const { host, scene } = await hostWithMod((on) => {
    on('tool.call', async (_$: unknown, _e: unknown, next: { signal: AbortSignal }) => {
      holding()
      if (!next.signal.aborted)
        await new Promise((resolve) => next.signal.addEventListener('abort', resolve))
      // A hook that throws once its event is abandoned is skipped: the chain goes on past it.
      throw new Error('aborted')
    })
  })
  const kit = await host.hostFor(scene, new Set(['m']))
  let ran = 0
  const input = { tool: 'Bash', command: 'rm -rf x' }
  const fired = fireIn({ kit: kit! }, 'tool.call', input, () => ++ran, stop.signal)
  // The turn stops while the hook holds the call.
  await held
  stop.abort()
  await expect(fired).rejects.toThrow()
  expect(ran).toBe(0)
})
