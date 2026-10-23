import { describe, expect, test } from 'bun:test'

import { dockerResourceLabel, dockerResourceUri } from './openTab'

describe('Docker resource tab identity', () => {
  test('uses the existing localix://resource/docker/ grammar for every resource kind', () => {
    expect(
      dockerResourceUri({
        kind: 'image',
        resource: {
          id: 'sha256:abc',
          repository: 'local/api',
          tag: 'latest',
          size: '10MB',
          createdAt: 'now',
        },
      }),
    ).toBe('localix://resource/docker/image/sha256%3Aabc')
    expect(
      dockerResourceUri({
        kind: 'volume',
        resource: { name: 'data', driver: 'local', scope: 'local' },
      }),
    ).toBe('localix://resource/docker/volume/data')
    expect(
      dockerResourceUri({
        kind: 'network',
        resource: { id: 'net-1', name: 'app', driver: 'bridge', scope: 'local' },
      }),
    ).toBe('localix://resource/docker/network/net-1')
  })

  test('builds a readable image title without inventing a tag', () => {
    expect(
      dockerResourceLabel({
        kind: 'image',
        resource: {
          id: 'sha256:abc',
          repository: 'local/api',
          tag: '<none>',
          size: '10MB',
          createdAt: 'now',
        },
      }),
    ).toBe('local/api')
  })
})
