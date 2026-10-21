import { describe, expect, test } from 'bun:test'
import { gateLabel } from './toolGateContext'

describe('gateLabel', () => {
  test('user approval', () => {
    expect(gateLabel({ decision: 'user-approved' })).toBe('Approved by you')
  })

  test('session-wide grant', () => {
    expect(gateLabel({ decision: 'session-grant' })).toContain('whole session')
  })

  test('allow rule names the rule when known', () => {
    expect(gateLabel({ decision: 'rule-allow', detail: 'bash(git *)' })).toBe(
      'Allowed by rule bash(git *)',
    )
    expect(gateLabel({ decision: 'rule-allow' })).toBe('Allowed by a permission rule')
  })
})
