import { describe, expect, it } from 'bun:test'

import { parseRecovery, recoveryAction, recoveryUri } from './recovery'

describe('the recovery vocabulary', () => {
  it('parses each verb with its parameter, and refuses what it does not know', () => {
    expect(parseRecovery('retry')).toEqual({ verb: 'retry' })
    expect(parseRecovery('open-settings:mcp/mcp-a/b')).toEqual({
      verb: 'open-settings',
      tab: 'mcp',
      // Split at the first slash only: a row's name may hold one.
      anchor: 'mcp-a/b',
    })
    expect(parseRecovery('sign-in:conn-1')).toEqual({ verb: 'sign-in', connectionId: 'conn-1' })
    expect(parseRecovery('restart:mcp:github')).toEqual({ verb: 'restart', subject: 'mcp:github' })
    expect(parseRecovery('reboot:x')).toBeNull()
    expect(parseRecovery('sign-in:')).toBeNull()
  })

  it('resolves to the same localix:// destinations every tip and link uses', () => {
    expect(recoveryUri(parseRecovery('open-settings:plugins')!)).toBe(
      'localix://ui/settings/plugins',
    )
    // Provider connections live in the model picker, so that is where "providers" opens.
    expect(recoveryUri(parseRecovery('open-settings:providers')!)).toBe('localix://ui/picker/model')
    expect(recoveryUri(parseRecovery('sign-in:conn-1')!)).toBe('localix://ui/picker/model')
    expect(recoveryUri(parseRecovery('restart:mcp:github')!)).toBe('localix://ui/settings/mcp')
    expect(recoveryUri(parseRecovery('retry')!)).toBeUndefined()
  })

  it('builds a navigating journal action, and refuses Retry, which needs the run', () => {
    expect(recoveryAction('open-settings:mcp', 'Open MCP settings')).toEqual({
      id: 'open-settings',
      label: 'Open MCP settings',
      kind: 'navigate',
      uri: 'localix://ui/settings/mcp',
      available: true,
    })
    expect(() => recoveryAction('retry')).toThrow()
  })
})
