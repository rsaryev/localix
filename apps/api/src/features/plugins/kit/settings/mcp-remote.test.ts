import { describe, expect, test } from 'bun:test'

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
    const config = { headersHelper: COUNTING }
    const remote = await remoteRequest(record(config), record(config).config, dir(), fetch)
    remote.connected()
    const response = await remote.fetch(URL_, { method: 'POST', body: '{}', headers: {} })
    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer t0', 'Bearer t1'])
    expect(remote.requestInit?.headers).toMatchObject({ Authorization: 'Bearer t1' })
  })

  test('the helper’s Authorization turns the OAuth fallback off', async () => {
    const config = { headersHelper: `printf '{"Authorization":"Bearer x"}'` }
    const remote = await remoteRequest(record(config), record(config).config, dir(), fetch)
    expect(remote.oauthFallback).toBe(false)
  })

  test('a record of Localix’s own registry or a subagent’s inline server runs no helper', async () => {
    for (const id of ['own-1', 'agent:a:api']) {
      const config = { headersHelper: `printf '{"Authorization":"Bearer x"}'` }
      const remote = await remoteRequest(record(config, id), record(config).config, dir(), fetch)
      expect(remote.requestInit).toBeUndefined()
      expect(remote.oauthFallback).toBe(true)
    }
  })

  test('a request to another host is passed through untouched', async () => {
    const { seen, fetch } = server('never')
    const config = { headersHelper: COUNTING }
    const remote = await remoteRequest(record(config), record(config).config, dir(), fetch)
    remote.connected()
    const response = await remote.fetch('https://auth.example/token', { method: 'POST', body: '' })
    expect(response.status).toBe(401)
    expect(seen).toEqual([null])
  })
})
