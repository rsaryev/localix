import { describe, expect, test } from 'bun:test'

import type { DockerContainer, DockerImage } from '../../backend/contracts'
import { sortDockerContainers, sortDockerImages } from './sortResources'

describe('Docker inventory sorting', () => {
  test('orders container state by operator relevance', () => {
    const container = (name: string, state: DockerContainer['state']): DockerContainer => ({
      id: name,
      name,
      image: 'api',
      state,
      status: state,
      ports: '',
      createdAt: '2026-07-23T10:00:00Z',
    })
    const rows = [container('old', 'exited'), container('live', 'running')]
    expect(
      sortDockerContainers(rows, { key: 'state', direction: 'asc' }).map((row) => row.name),
    ).toEqual(['live', 'old'])
  })

  test('sorts images by the byte count the backend reported, unknown sizes last', () => {
    const image = (id: string, size: string, sizeBytes?: number): DockerImage => ({
      id,
      repository: id,
      tag: 'latest',
      size,
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
      createdAt: '2026-07-23T10:00:00Z',
    })
    const rows = [
      image('large', '1.2GB', 1_200_000_000),
      image('unknown', '--'),
      image('small', '900MB', 900_000_000),
    ]
    expect(sortDockerImages(rows, { key: 'size', direction: 'asc' }).map((row) => row.id)).toEqual([
      'small',
      'large',
      'unknown',
    ])
  })
})
