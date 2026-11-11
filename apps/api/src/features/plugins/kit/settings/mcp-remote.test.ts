import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import type { McpServerRecord } from '../../../mcp/repository'
import { remoteRequest } from './mcp-remote'

/**
 * Localix's glue around the kit's headersHelper (mcp.md, "Use dynamic headers for custom
 * authentication"): which records may run one, and the fetch that runs it again once on a call
 * answered 401 or 403, after the connection is up. The kit decides the rest (its tests).
 */
const dir = tempDirPerTest('mcp-remote-')

const URL_ = 'https://api.example/mcp'
const record = (
  config: Record<string, unknown>,
  id = 'claude-code:project:api',
): McpServerRecord => ({
  id,
  userId: 'u',
  projectId: '',
  name: 'api',
  description: '',
  transport: 'http',
  config: { url: URL_, ...config },
  createdAt: '',
  updatedAt: '',
})

/** The stamp `mcp-plan.ts` puts on a server read in a folder trusted itself. */
const TRUSTED = { headersHelperTrust: { source: 'persisted', key: '/work' } }

/** A helper that prints `Bearer t0`, then `Bearer t1`, … on each run. */
const COUNTING = `n=$(cat count 2>/dev/null || echo 0); echo $((n+1)) > count; printf '{"Authorization":"Bearer t%s"}' $n`

/** A fetch that accepts only `Bearer <token>` and records what it was sent. */
function server(token: string) {
  const seen: Array<string | null> = []
  const fetch = async (_: string | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization')
    seen.push(auth)
    return new Response('', { status: auth === `Bearer ${token}` ? 200 : 401 })
  }
  return { seen, fetch }
}

describe('a remote request of a server with a headersHelper', () => {
  test('on a call answered 401 the helper runs again and the call is sent once more', async () => {
    const { seen, fetch } = server('t1')
    const config = { ...TRUSTED, headersHelper: COUNTING }
    const remote = await remoteRequest(record(config), record(config).config, dir(), fetch)
    remote.connected()
    const response = await remote.fetch(URL_, { method: 'POST', body: '{}', headers: {} })
    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer t0', 'Bearer t1'])
    expect(remote.requestInit?.headers).toMatchObject({ Authorization: 'Bearer t1' })
  })

  test('the helper’s Authorization turns the OAuth fallback off', async () => {
    const config = { ...TRUSTED, headersHelper: `printf '{"Authorization":"Bearer x"}'` }
    const remote = await remoteRequest(record(config), record(config).config, dir(), fetch)
    expect(remote.oauthFallback).toBe(false)
  })

  test('a record of Localix’s own registry or a subagent’s inline server runs no helper', async () => {
    for (const id of ['own-1', 'agent:a:api']) {
      const config = { ...TRUSTED, headersHelper: `printf '{"Authorization":"Bearer x"}'` }
      const remote = await remoteRequest(record(config, id), record(config).config, dir(), fetch)
      expect(remote.requestInit).toBeUndefined()
      expect(remote.oauthFallback).toBe(true)
    }
  })

  test('a request to another host is passed through untouched', async () => {
    const { seen, fetch } = server('never')
    const config = { ...TRUSTED, headersHelper: COUNTING }
    const remote = await remoteRequest(record(config), record(config).config, dir(), fetch)
    remote.connected()
    const response = await remote.fetch('https://auth.example/token', { method: 'POST', body: '' })
    expect(response.status).toBe(401)
    expect(seen).toEqual([null])
  })
})

/**
 * Whether a helper runs, for each record and each trust of the folder it was read in (mcp.md, "Trust
 * a folder before its headersHelper runs": only the folder's own persisted trust; a parent folder's
 * does not count). `before` is what Localix did when it dropped the helper of a project or local
 * server in a folder trusted neither itself nor by a parent, and ran every other: the gate is never
 * looser than that.
 */
describe('whether a headersHelper runs, by origin and trust', () => {
  // A user or managed server's helper runs in Claude Code's configuration directory, which the
  // test's own HOME does not have until something makes it.
  beforeAll(() => mkdirSync(join(process.env.HOME ?? '', '.claude'), { recursive: true }))
  const ORIGINS = {
    project: 'claude-code:project:api',
    local: 'claude-code:local:api',
    user: 'claude-code:user:api',
    managed: 'claude-code:managed:api',
    plugin: 'plugin:p@m:api',
    own: 'own-1',
    agent: 'agent:a:api',
  } as const
  type Trust = 'persisted' | 'parent-folder' | 'none' | 'unstamped' | 'malformed'
  const STAMP: Record<Trust, Record<string, unknown>> = {
    persisted: TRUSTED,
    'parent-folder': { headersHelperTrust: { source: 'parent-folder', key: '/work' } },
    none: { headersHelperTrust: { source: 'none', key: '/work' } },
    unstamped: {},
    malformed: { headersHelperTrust: { source: 'trusted', key: '/work' } },
  }
  const folderBound = new Set(['project', 'local'])
  const ranBefore = (origin: keyof typeof ORIGINS, trust: Trust): boolean =>
    !['own', 'agent'].includes(origin) &&
    (!folderBound.has(origin) || trust === 'persisted' || trust === 'parent-folder')
  const runsNow = (origin: keyof typeof ORIGINS, trust: Trust): boolean =>
    !['own', 'agent'].includes(origin) && (!folderBound.has(origin) || trust === 'persisted')

  for (const origin of Object.keys(ORIGINS) as Array<keyof typeof ORIGINS>)
    for (const trust of Object.keys(STAMP) as Trust[])
      test(`${origin}, ${trust}: ${runsNow(origin, trust) ? 'runs' : 'does not run'}`, async () => {
        const config = {
          ...STAMP[trust],
          headersHelper: `printf '{"X-Helped":"1"}'`,
          // A plugin's helper runs in its plugin's folder.
          ...(origin === 'plugin' ? { headersHelperRoot: dir() } : {}),
        }
        const server = record(config, ORIGINS[origin])
        const remote = await remoteRequest(server, server.config, dir(), fetch)
        const ran = remote.requestInit?.headers !== undefined
        expect(ran).toBe(runsNow(origin, trust))
        expect(ran && !ranBefore(origin, trust)).toBe(false)
      })
})
