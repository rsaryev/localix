import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'

import { configDirectoryOf, globalConfigFileOf } from '@rsaryev/llx-plugin/settings'

import { claudeConfigDir, claudeStateFile } from '../../../cc-settings/config-dir'

// env-vars.md, `CLAUDE_CONFIG_DIR` and "In settings files": Localix's one reading of the variable
// is the kit's, an empty value unset and any other taken as written (made absolute only).
describe("Localix's reading of CLAUDE_CONFIG_DIR is the kit's", () => {
  const home = '/home/me'
  const cases = [undefined, '', '/srv/claude', '~/.claude-work', ' /srv/padded ']

  for (const value of cases)
    test(`CLAUDE_CONFIG_DIR=${JSON.stringify(value)}`, () => {
      const env = { CLAUDE_CONFIG_DIR: value }
      expect(claudeConfigDir(home, env)).toBe(resolve(configDirectoryOf(home, value, join)))
      expect(claudeStateFile(home, env)).toBe(resolve(globalConfigFileOf(home, value, join)))
    })

  test('a `~` is not expanded and spaces are not trimmed', () => {
    expect(claudeConfigDir(home, { CLAUDE_CONFIG_DIR: '~/.claude-work' })).toBe(
      resolve('~/.claude-work'),
    )
    expect(claudeConfigDir(home, { CLAUDE_CONFIG_DIR: ' /srv/padded ' })).toBe(
      resolve(' /srv/padded '),
    )
  })
})
