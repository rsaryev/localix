import { describe, expect, test } from 'bun:test'

import {
  grantedScopes,
  grantScope,
  listSessionGrants,
  revokeSessionGrant,
  type SessionGrants,
} from './session-grants'

const own = 'chat'
const other = 'other'
const child = 'child'

describe('"This session" grants belong to the requester that was answered', () => {
  test("one session's grant does not approve a sub-agent's session", () => {
    // Keyed by the conversation alone, "allow git" answered on the parent's card auto-approved
    // git for every sub-agent whose cards surface in the same conversation.
    const grants: SessionGrants = new Map()
    grantScope(grants, 'chat', own, 'bash(git)')
    expect([...grantedScopes(grants, 'chat', own)]).toEqual(['bash(git)'])
    expect(grantedScopes(grants, 'chat', child).size).toBe(0)
  })

  test('the chip lists and revokes everything granted in the conversation', () => {
    const grants: SessionGrants = new Map()
    grantScope(grants, 'chat', own, 'bash(git)')
    grantScope(grants, 'chat', child, 'bash(git)')
    grantScope(grants, 'chat', child, 'write')
    expect(listSessionGrants(grants, 'chat')).toEqual(['bash(git)', 'write'])

    expect(revokeSessionGrant(grants, 'chat', 'bash(git)')).toEqual(['write'])
    expect(grantedScopes(grants, 'chat', own).size).toBe(0)
    expect(revokeSessionGrant(grants, 'chat')).toEqual([])
    expect(grants.has('chat')).toBe(false)
  })

  test('revoking in an unknown conversation changes nothing', () => {
    const grants: SessionGrants = new Map()
    grantScope(grants, 'chat', own, 'bash(git)')
    expect(revokeSessionGrant(grants, other, 'bash(git)')).toEqual([])
    expect(listSessionGrants(grants, 'chat')).toEqual(['bash(git)'])
  })
})
