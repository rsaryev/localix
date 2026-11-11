import { describe, expect, test } from 'bun:test'

import { kitEntry } from './testing'
import { leftByMarketplaceUpdate, updateSkipOf } from './updates'

/**
 * Which updates leave a plugin to the person, as the kit decides (`pluginSkippedByAutoUpdate`,
 * `planUpdate`; their rules tested in the kit): a `headersHelper` entry and a `command` source.
 */
const plain = kitEntry({ name: 'plain', source: './plugins/plain' })
const helper = kitEntry({ name: 'helper', source: './plugins/helper', headersHelper: 'echo {}' })
const command = kitEntry({ name: 'cmd', source: { source: 'command', command: 'echo /x' } })

describe('updates left to the person', () => {
  test('an update check skips a headersHelper entry and a command source, never a plain one', () => {
    expect(updateSkipOf(plain)).toBeUndefined()
    expect(updateSkipOf(helper)).toBe('headers-helper')
    expect(updateSkipOf(command)).toBe('command-needs-acceptance')
  })

  test('Update marketplace leaves the headersHelper entry and the command source', () => {
    expect([...leftByMarketplaceUpdate('m', [plain, helper, command])].sort()).toEqual([
      'cmd',
      'helper',
    ])
  })
})
