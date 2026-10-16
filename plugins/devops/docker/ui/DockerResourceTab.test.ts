import { describe, expect, test } from 'bun:test'

import {
  dockerResourceDetailMatches,
  dockerResourceFields,
  dockerResourceLabel,
  dockerResourceNeedsInitialLoad,
  type DockerResourceDetail,
} from './model/dockerResourceDetail'

const image: DockerResourceDetail = {
  kind: 'image',
  resource: {
    id: 'sha256:abc',
    repository: 'local/api',
    tag: 'latest',
    size: '10MB',
    createdAt: 'now',
  },
}

describe('Docker resource detail seed', () => {
  test('reuses only a snapshot for the exact kind and identity', () => {
    expect(dockerResourceDetailMatches(image, 'image', 'sha256:abc')).toBe(true)
    expect(dockerResourceDetailMatches(image, 'image', 'sha256:other')).toBe(false)
    expect(dockerResourceDetailMatches(image, 'network', 'sha256:abc')).toBe(false)
    expect(dockerResourceDetailMatches(undefined, 'image', 'sha256:abc')).toBe(false)
  })

  test('uses names for volumes and ids for networks', () => {
    expect(
      dockerResourceDetailMatches(
        { kind: 'volume', resource: { name: 'data', driver: 'local', scope: 'local' } },
        'volume',
        'data',
      ),
    ).toBe(true)
    expect(
      dockerResourceDetailMatches(
        {
          kind: 'network',
          resource: { id: 'net-1', name: 'app', driver: 'bridge', scope: 'local' },
        },
        'network',
        'net-1',
      ),
    ).toBe(true)
  })

  test('derives compact labels and fields without presentation state', () => {
    expect(dockerResourceLabel(image)).toBe('local/api:latest')
    expect(dockerResourceFields(image)).toEqual([
      { label: 'Repository', value: 'local/api' },
      { label: 'Tag', value: 'latest' },
      { label: 'Image ID', value: 'sha256:abc' },
      { label: 'Size', value: '10MB' },
      { label: 'Created', value: 'now' },
    ])
  })

  test('shows loading immediately when a hidden unseeded target becomes active', () => {
    expect(dockerResourceNeedsInitialLoad(true, '', 'image/sha256:abc', null)).toBe(true)
    expect(dockerResourceNeedsInitialLoad(false, '', 'image/sha256:abc', null)).toBe(false)
    expect(dockerResourceNeedsInitialLoad(true, 'image/sha256:abc', 'image/sha256:abc', null)).toBe(
      false,
    )
    expect(dockerResourceNeedsInitialLoad(true, '', 'image/sha256:abc', image)).toBe(false)
  })
})
