import { describe, expect, test } from 'bun:test'

import { resolvePluginRouteScope } from './route-scope'

const OWNED = new Map([['s-own', '/work/own']])

function resolve(query: string) {
  return resolvePluginRouteScope({
    userId: 'u1',
    request: new Request(`http://host/rpc/game/state${query}`),
    // The real gate rejects a session the user does not own; this one answers only for OWNED.
    resolveSessionCwd: async (_userId, sessionId) => {
      const cwd = OWNED.get(sessionId)
      if (!cwd) throw new Error('session_not_found')
      return cwd
    },
    resolveProjectCwd: async (_userId, projectId) => (projectId === 'p1' ? '/work/p1' : null),
    fallbackCwd: '/work/default',
  })
}

describe('the scope a plugin route runs in', () => {
  test('an owned session reaches the plugin, with its working directory', async () => {
    expect(await resolve('?sessionId=s-own')).toEqual({
      userId: 'u1',
      sessionId: 's-own',
      projectId: '',
      cwd: '/work/own',
    })
  })

  test('a foreign or deleted session never reaches the plugin', async () => {
    const scope = await resolve('?sessionId=s-gone&projectId=p1')
    expect(scope.sessionId).toBeUndefined()
    expect(scope).toEqual({ userId: 'u1', projectId: 'p1', cwd: '/work/p1' })
  })

  test('no session asked for: the project, else the fallback', async () => {
    expect((await resolve('')).cwd).toBe('/work/default')
    expect((await resolve('?sessionId=%20%20')).sessionId).toBeUndefined()
  })
})
