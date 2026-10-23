import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { KubeNode, KubePod } from '../../backend/contracts'
import { nodeSnapshotMatches } from '../model/useKubernetesNodeTab'
import { KubernetesNodeTab } from './KubernetesNodeTab'
import { RelatedPodRow } from './RelatedPodRow'

function node(name = 'worker-1'): KubeNode {
  return {
    name,
    status: 'Ready',
    roles: ['worker'],
    version: 'v1.32.0',
    schedulable: true,
    createdAt: '2026-07-28T00:00:00Z',
    allocatableCpuNanos: 4_000_000_000,
    allocatableMemoryBytes: 8 * 1024 ** 3,
  }
}

test('accepts only the exact node snapshot as the instant detail seed', () => {
  expect(nodeSnapshotMatches(node('worker-1'), 'worker-1')).toBe(true)
  expect(nodeSnapshotMatches(node('worker-2'), 'worker-1')).toBe(false)
  expect(nodeSnapshotMatches(undefined, 'worker-1')).toBe(false)
})

test('composes a seeded node overview without a loading flash', () => {
  const html = renderToStaticMarkup(
    <KubernetesNodeTab name="worker-1" context="local" initialNode={node()} />,
  )

  expect(html).toContain('Kubernetes node · local')
  expect(html).toContain('aria-label="Node view"')
  expect(html).toContain('aria-label="Refresh node"')
  expect(html).not.toContain('Link worker-1 to chat')
  expect(html).toContain('Schedulable')
  expect(html).toContain('v1.32.0')
  expect(html).not.toContain('Loading node')
})

test('ignores a snapshot for another node instead of showing stale details', () => {
  const html = renderToStaticMarkup(
    <KubernetesNodeTab name="worker-1" context="local" initialNode={node('worker-2')} />,
  )
  expect(html).toContain('Loading node')
  expect(html).not.toContain('v1.32.0')
})

test('related pod rows stay draggable without restoring a Link column', () => {
  const pod = {
    name: 'api-0',
    namespace: 'apps',
    phase: 'Running',
    ready: '1/1',
    restarts: 0,
    createdAt: '2026-07-28T00:00:00Z',
  } as KubePod
  const html = renderToStaticMarkup(<RelatedPodRow pod={pod} context="local" showNamespace />)
  expect(html).toContain('role="listitem" draggable="true"')
  expect(html).toContain('apps · Running')
  expect(html).not.toContain('data-resource-column="link"')
})
