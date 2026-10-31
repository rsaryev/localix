/**
 * A command copied from Claude Code's documentation that Localix cannot run is answered with why,
 * and with what to do instead: never "unknown command", never a prompt to the model.
 */
import { describe, expect, test } from 'bun:test'
import { handleUnresolvedSlashCommand } from './command-handlers'

async function reply(prompt: string) {
  const replies: { text: string; tone?: string }[] = []
  await handleUnresolvedSlashCommand(
    {
      now: () => '2026-01-01',
      insertDirectReply: async (_user, _session, _prompt, text, _ts, tone) => {
        replies.push({ text, tone })
        return {} as never
      },
    },
    'u',
    's',
    prompt,
  )
  return replies[0]
}

describe('Claude Code commands Localix cannot run', () => {
  test('say why, not "unknown", and point at the Localix equivalent when there is one', async () => {
    const login = await reply('/login')
    expect(login?.text).not.toContain('Unknown slash command')
    expect(login?.text).toContain('Settings → Models')

    expect((await reply('/branch'))?.text).toContain('`/fork`')
    expect((await reply('/undo'))?.text).toContain('`/rewind`')
    expect((await reply('/autocompact 500k'))?.text).toContain('Context limit')
    expect((await reply('/QUIT'))?.text).toContain('`/quit`')
  })

  test('a bundled skill is named as one, and the reply is a note rather than an error', async () => {
    const review = await reply('/security-review')
    expect(review?.text).toContain('bundled skill')
    expect(review?.tone).toBe('warning')
  })

  test('a name that is not Claude Code’s is still unknown, with a suggestion', async () => {
    expect((await reply('/usgae'))?.text).toContain('Unknown slash command `/usgae`')
  })
})
