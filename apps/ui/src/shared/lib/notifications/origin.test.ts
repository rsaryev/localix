import { describe, expect, it } from 'bun:test'
import { originSession, routeEventOrigin } from './origin'

describe('event origin', () => {
  it('parses scoped and legacy routes into typed session provenance', () => {
    expect(routeEventOrigin('/project/p-1/LOCALIX-14/files')).toEqual({
      kind: 'session',
      sessionId: 'LOCALIX-14',
      projectId: 'p-1',
    })
    // A legacy `/chat/:id` link carries no scope until its redirect resolves one.
    expect(routeEventOrigin('/chat/LOCALIX-18')).toEqual({
      kind: 'session',
      sessionId: 'LOCALIX-18',
      projectId: null,
    })
    expect(routeEventOrigin('/settings')).toEqual({ kind: 'application' })
  })

  it('extracts session coordinates from both session and resource origins', () => {
    expect(
      originSession({
        kind: 'resource',
        sessionId: 'LOCALIX-18',
        projectId: null,
        resourceKind: 'tool',
        resourceId: 'call-1',
      }),
    ).toEqual({ sessionId: 'LOCALIX-18', projectId: null })
    expect(originSession({ kind: 'application' })).toBeNull()
  })
})
