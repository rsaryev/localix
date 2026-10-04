import { describe, expect, test } from 'bun:test'

import {
  grantedScopes,
  grantScope,
  listSessionGrants,
  revokeSessionGrant,
  type SessionGrants,
} from './session-grants'

const lead = { sessionId: 'room', agentId: 'lead' }
const qa = { sessionId: 'room', agentId: 'qa' }
const child = { sessionId: 'child', agentId: 'lead' }

describe('"This session" grants belong to the requester that was answered', () => {
  test("one participant's grant does not approve another participant or a sub-agent", () => {
    // Keyed by the conversation alone, "allow git" answered on @lead's card auto-approved git
    // for @qa and for every sub-agent whose cards surface in the same conversation.
    const grants: SessionGrants = new Map()
    grantScope(grants, 'room', lead, 'bash(git)')
    expect([...grantedScopes(grants, 'room', lead)]).toEqual(['bash(git)'])
    expect(grantedScopes(grants, 'room', qa).size).toBe(0)
    expect(grantedScopes(grants, 'room', child).size).toBe(0)
  })

  test('the chip lists and revokes everything granted in the conversation', () => {
    const grants: SessionGrants = new Map()
    grantScope(grants, 'room', lead, 'bash(git)')
    grantScope(grants, 'room', qa, 'bash(git)')
    grantScope(grants, 'room', qa, 'write')
    expect(listSessionGrants(grants, 'room')).toEqual(['bash(git)', 'write'])

    expect(revokeSessionGrant(grants, 'room', 'bash(git)')).toEqual(['write'])
    expect(grantedScopes(grants, 'room', lead).size).toBe(0)
    expect(revokeSessionGrant(grants, 'room')).toEqual([])
    expect(grants.has('room')).toBe(false)
  })

  test('revoking in an unknown conversation changes nothing', () => {
    const grants: SessionGrants = new Map()
    grantScope(grants, 'room', lead, 'bash(git)')
    expect(revokeSessionGrant(grants, 'other', 'bash(git)')).toEqual([])
    expect(listSessionGrants(grants, 'room')).toEqual(['bash(git)'])
  })
})
