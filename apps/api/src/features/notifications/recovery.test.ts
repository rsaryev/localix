import { describe, expect, it } from 'bun:test'

import { localixUiUri } from '@localixai/mini-app-sdk/navigation'

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
    expect(parseRecovery('open-store:mini-app/tracker')).toEqual({
      verb: 'open-store',
      kind: 'mini-app',
      id: 'tracker',
    })
    expect(parseRecovery('open-store:plugin')).toEqual({ verb: 'open-store', kind: 'plugin' })
    expect(parseRecovery('sign-in:conn-1')).toEqual({ verb: 'sign-in', connectionId: 'conn-1' })
    expect(parseRecovery('restart:mcp:github')).toEqual({ verb: 'restart', subject: 'mcp:github' })
    expect(parseRecovery('reboot:x')).toBeNull()
    expect(parseRecovery('sign-in:')).toBeNull()
  })

  it('resolves to the same localix:// destinations every tip and link uses', () => {
    expect(recoveryUri(parseRecovery('open-settings:permissions')!)).toBe(
      'localix://ui/settings/permissions',
    )
    expect(recoveryUri(parseRecovery('open-store:mini-app/tracker')!)).toBe(
      localixUiUri('work-item', ['store'], { kind: 'mini-app', id: 'tracker' }),
    )
    // Provider connections live in the model picker, so that is where "providers" opens.
    expect(recoveryUri(parseRecovery('open-settings:providers')!)).toBe('localix://ui/picker/model')
    expect(recoveryUri(parseRecovery('sign-in:conn-1')!)).toBe('localix://ui/picker/model')
    // A restart control lives on the server's or plugin's Store page.
    expect(recoveryUri(parseRecovery('restart:mcp:github')!)).toBe(
      localixUiUri('work-item', ['store'], { kind: 'mcp-server', id: 'github' }),
    )
    expect(recoveryUri(parseRecovery('retry')!)).toBeUndefined()
  })

  it('builds a navigating journal action, and refuses Retry, which needs the run', () => {
    expect(recoveryAction('open-store:mcp-server/github', 'Open MCP server')).toEqual({
      id: 'open-store',
      label: 'Open MCP server',
      kind: 'navigate',
      uri: localixUiUri('work-item', ['store'], { kind: 'mcp-server', id: 'github' }),
      available: true,
    })
    expect(() => recoveryAction('retry')).toThrow()
  })
})
