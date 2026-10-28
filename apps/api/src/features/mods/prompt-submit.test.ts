import { expect, test } from 'bun:test'
import { hostWithMods } from './testing/testing-host'

test('a prompt a mod submits raises prompt.submit once, with the plugin as its origin', async () => {
  const heard: { text: string; origin: unknown }[] = []
  const woken: string[] = []
  // `other` hears the call; `sender` is the mod calling, so its own hook stays out of the chain.
  const { scope } = await hostWithMods(
    {
      sender: (on) => {
        on('turn.start', async ($, e, next) => {
          await ($ as { prompt: { submit(p: { text: string }): Promise<unknown> } }).prompt.submit({
            text: 'List the TODOs.',
          })
          return next(e)
        })
      },
      other: (on) => {
        on('prompt.submit', async ($, e, next) => {
          const { text, origin } = e as { text: string; origin: unknown }
          heard.push({ text, origin })
          return next(e)
        })
      },
    },
    { submitPrompt: async (_scene, input) => void woken.push(`[${input.plugin}] ${input.text}`) },
  )
  await scope.turnStart('go', 't1')
  expect(heard).toEqual([{ text: 'List the TODOs.', origin: { kind: 'plugin', name: 'sender' } }])
  // The conversation's next turn reads the prompt the wake delivered: it is not a second submit.
  const entered = await scope.submit(woken[0]!, 't2')
  expect(entered).toMatchObject({ dropped: false, text: '[sender] List the TODOs.' })
  expect(heard).toHaveLength(1)
  // The person's own prompt afterwards is a submit again.
  await scope.submit('and then?', 't3')
  expect(heard).toHaveLength(2)
  expect(heard[1]!.origin).toEqual({ kind: 'composer' })
})

test('a submitted prompt is forgotten when its turn starts, even if no mod hears prompt.submit', async () => {
  const woken: string[] = []
  // Only `sender` is loaded, and it does not hook prompt.submit.
  const { scope, host, scene } = await hostWithMods(
    {
      sender: (on) => {
        on('turn.start', async ($, e, next) => {
          await ($ as { prompt: { submit(p: { text: string }): Promise<unknown> } }).prompt.submit({
            text: 'Go on.',
          })
          return next(e)
        })
      },
    },
    { submitPrompt: async (_scene, input) => void woken.push(`[${input.plugin}] ${input.text}`) },
  )
  await scope.turnStart('go', 't1')
  await scope.submit(woken[0]!, 't2')
  // Left behind, it would make a later identical typed prompt skip the hooks of a mod loaded since.
  expect(host.composer.takeSubmitted(scene.sessionId!, woken[0]!)).toBe(false)
})
