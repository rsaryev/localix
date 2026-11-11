import { expect, test } from 'bun:test'
import { hostWithMod } from '../../mods/testing/testing-host'
import { sessionFixture } from '../../../testing/session-fixture'
import type { CommandHandlerContext } from './command-handlers-context'
import { handleModCommand } from './command-handlers-mod-command'

/** A mod's `/command`, typed in a conversation: what the conversation shows of its answer. */
const session = sessionFixture({ id: 'mod-command', userId: 'u' })

async function typed(prompt: string, answer?: { text: string }) {
  const replies: string[] = []
  const { host, scene } = await hostWithMod((on) => {
    on('session.start', async ($) => {
      await ($ as { command: { register(spec: unknown): Promise<unknown> } }).command.register({
        name: 'tally',
        description: 'Count',
      })
    })
    on('command.run', async (_$, e, next) => (answer ? answer : next(e)))
  })
  const ctx = {
    deps: { mods: host },
    now: () => 'now',
    resolveSessionWorkingDir: async () => scene.cwd,
    insertDirectReply: async (_u: string, _s: string, _p: string, reply: string) => {
      replies.push(reply)
      return { sessionId: session.id, messageId: 'reply' }
    },
  } as unknown as CommandHandlerContext
  await handleModCommand(ctx, 'u', session.id, session, prompt)
  return replies
}

test('a hook’s text is the command’s output, under the mod’s name', async () => {
  expect(await typed('/tally', { text: '3 files' })).toEqual(['m: 3 files'])
})

test('a command no command.run hook answers says so, and how to answer it', async () => {
  expect(await typed('/tally')).toEqual([
    'm registered /tally but no command.run hook answered it. Add a command.run hook for /tally that returns { text }.',
  ])
})

test('a command the person typed reaches command.run from the composer, presented on the main screen', async () => {
  const seen: unknown[] = []
  const { host, scene } = await hostWithMod((on) => {
    on('session.start', async ($) => {
      await ($ as { command: { register(spec: unknown): Promise<unknown> } }).command.register({
        name: 'tally',
      })
    })
    on('command.run', async (_$, e) => {
      const { origin, presentation } = e as { origin: unknown; presentation: unknown }
      seen.push({ origin, presentation })
      return { text: 'ok' }
    })
  })
  const ctx = {
    deps: { mods: host },
    now: () => 'now',
    resolveSessionWorkingDir: async () => scene.cwd,
    insertDirectReply: async () => ({ sessionId: session.id, messageId: 'reply' }),
  } as unknown as CommandHandlerContext
  await handleModCommand(ctx, 'u', session.id, session, '/tally')
  expect(seen).toEqual([
    { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } },
  ])
})
