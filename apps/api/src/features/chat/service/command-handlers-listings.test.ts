import { describe, expect, test } from 'bun:test'
import type { MessageMutationResponse } from '../contracts'
import { handleHelpControlCommand } from './command-handlers-listings'

/**
 * `/help <command>` renders the shared slash catalog, including each argument's gating
 * condition. That condition can name SEVERAL accepted values — one `/plugin` argument
 * serves enable/disable/remove/update/details — and the renderer interpolated the raw
 * array, so the help text leaned on JavaScript's own comma-join: readable by luck, and
 * wrong the moment a value contains a comma. Nothing covered this output at all.
 */
/** `arg` is the raw prompt — the handler strips the command word itself. */
function help(prompt = '/help'): Promise<string> {
  let text = ''
  const directReply = async (value: string) => {
    text = value
    return {} as MessageMutationResponse
  }
  return handleHelpControlCommand(directReply, prompt).then(() => text)
}

describe('/help <command> detail', () => {
  test('spells out every value a multi-value gate accepts', async () => {
    const text = await help('/help plugin')
    expect(text).toContain('only after action =')
    for (const action of ['enable', 'disable', 'remove', 'update', 'details']) {
      expect(text).toContain(`\`${action}\``)
    }
    // The array must never reach the template as an array.
    expect(text).not.toContain('enable,disable')
  })

  test('a single-value gate reads as one value, not a list', async () => {
    const text = await help('/help plugin')
    expect(text).toContain('only after msub = `remove`')
  })

  test('lists a command and suggests a near match for a typo', async () => {
    expect(await help()).toContain('**Slash commands**')
    expect(await help('/help plugn')).toContain('/plugin')
  })
})
