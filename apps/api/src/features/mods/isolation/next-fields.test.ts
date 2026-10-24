import { expect, test } from 'bun:test'
import { createScriptVms } from '@localixai/engine-scripts'
import { hostWithVms } from './testing/testing-mods'

/** `next.event`, `next.is` and `next.trace` as a hooks module reads them in its VM. */

const vms = createScriptVms()

const WATCHER = `
export function register(on) {
  on('command.*', async ($, e, next) => {
    const answer = await next(e)
    if (!next.is('command.run', e)) return answer
    const trace = next.trace.map((link) => link.plugin + ':' + link.outcome).join(',')
    return { text: next.event + ' ' + next.is('!command.describe', e) + ' ' + trace }
  })
}
`

test('a hook in its VM reads the event’s name, matches a pattern, and traces the links beneath', async () => {
  const { command } = await hostWithVms({ watcher: WATCHER }, { vms })
  expect((await command('watcher', 'anything')).text).toBe('command.run true engine:returned')
})
