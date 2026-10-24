import { describe, expect, test } from 'bun:test'
import type { ModsApi } from '@localixai/claude-plugin/mods'
import type { ModsPorts } from '../contracts'
import { hostWithMod } from '../testing/testing-host'

/** `$` calls whose answers a mod reads, in Claude Code's shapes. */

const call = ($: ModsApi, path: string, ...args: unknown[]) => {
  const [namespace, name] = path.split('.') as [string, string]
  return ($[namespace]![name] as (...rest: unknown[]) => Promise<unknown>)(...args)
}

/** What a mod's `turn.start` hook got back from each call, in order. */
async function answersOf(
  calls: (($: ModsApi) => Promise<unknown>)[],
  ports: Partial<ModsPorts> = {},
) {
  const answers: unknown[] = []
  const { scope } = await hostWithMod((on) => {
    on('turn.start', async ($, e, next) => {
      for (const one of calls)
        answers.push(await one($).catch((error: Error) => `threw: ${error.message}`))
      return next(e)
    })
  }, ports)
  await scope.turnStart('go', 't1')
  return answers
}

describe('the answers of $ calls', () => {
  test('registrations answer what they registered', async () => {
    expect(
      await answersOf([
        ($) => call($, 'command.register', { name: 'recap', description: 'Recap' }),
        ($) => call($, 'tool.register', { name: 'count', description: 'Count' }),
        ($) => call($, 'agent.register', { name: 'scout', description: 'Scout', prompt: 'Look.' }),
      ]),
    ).toEqual([{ command: 'recap' }, { tool: 'mcp__m__count' }, { agent: 'm:scout' }])
  })

  test('$.command.list lists Localix’s own commands and skills beside the mods’', async () => {
    const [listed] = await answersOf(
      [
        async ($) => {
          await call($, 'command.register', { name: 'recap', description: 'Recap' })
          return call($, 'command.list')
        },
      ],
      {
        listCommands: async () => [
          { name: 'clear', description: 'Start over', source: 'builtin' },
          { name: 'commit', description: 'Commit', source: 'user' },
        ],
      },
    )
    expect(listed).toEqual([
      { name: 'clear', description: 'Start over', source: 'builtin' },
      { name: 'commit', description: 'Commit', source: 'user' },
      { name: 'recap', description: 'Recap', source: 'plugin', plugin: 'm' },
    ])
  })

  test('$.ui.notify says no channel sent it on the desktop; $.prompt.submit says what entered', async () => {
    const submitted: unknown[] = []
    const shown: unknown[] = []
    const answers = await answersOf(
      [
        ($) => call($, 'ui.notify', 'Build done'),
        ($) => call($, 'prompt.submit', { text: 'Go on.' }),
      ],
      {
        notify: (_scene, input) => void shown.push(input),
        submitPrompt: async (_scene, input) => void submitted.push(input),
      },
    )
    expect(answers).toEqual([
      { isSent: false, reason: 'no-surface' },
      { text: 'Go on.', origin: { kind: 'plugin', name: 'm' } },
    ])
    expect(shown).toEqual([])
    expect(submitted).toEqual([{ text: 'Go on.', asUser: false, plugin: 'm' }])
  })
})
