import { describe, expect, test } from 'bun:test'

import type { SendResponse } from '../../backend/contracts'
import { buildRequestMessageContext } from './requestMessageContext'

const response: SendResponse = {
  status: 200,
  statusText: 'OK',
  url: 'https://api.dev/users',
  headers: { 'content-type': 'application/json' },
  body: '{"ok":true}',
  bytes: 11,
  truncated: false,
  elapsedMs: 12,
  hops: [{ url: 'https://api.dev/users', status: 200, elapsedMs: 12 }],
}

describe('active API workbench context', () => {
  test('publishes the saved request before it has ever been sent', () => {
    const context = buildRequestMessageContext('users/list', null)
    expect(context.bindings).toHaveLength(1)
    expect(context.bindings[0]).toMatchObject({
      kind: 'context',
      target: {
        kind: 'resource',
        uri: 'localix://resource/api/users%2Flist',
        label: 'users/list',
      },
    })
  })

  test('adds the inspected response as a second exact binding', () => {
    const context = buildRequestMessageContext('users/list', response)
    expect(context.bindings).toHaveLength(2)
    expect(context.bindings[1]).toMatchObject({
      kind: 'context',
      target: { kind: 'snippet', label: 'users/list response' },
    })
  })
})
