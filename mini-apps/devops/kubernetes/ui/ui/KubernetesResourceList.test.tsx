import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { KubernetesResourceList } from './KubernetesResourceList'
import type { KubernetesResourceListProps } from './resourceListTypes'

function props(resource: KubernetesResourceListProps['resource']): KubernetesResourceListProps {
  return {
    resource,
    sort: { key: 'name', direction: 'asc' },
    query: '',
    context: 'local',
    namespace: 'default',
    pods: [],
    deployments: [],
    services: [],
    nodes: [],
    portForwards: [],
    podUsage: new Map(),
    nodeUsage: new Map(),
    pendingPods: {},
    onForward: () => {},
    onDeleteRequest: () => {},
    onScale: () => {},
    onRestart: () => {},
    onNodeAction: () => {},
    onStopForward: () => {},
  }
}

test('routes each Kubernetes inventory kind to its focused empty state', () => {
  const labels = {
    workloads: 'No workloads here.',
    pods: 'No pods here.',
    deployments: 'No deployments here.',
    services: 'No services here.',
    nodes: 'No nodes here.',
    portForwards: 'No port forwards here.',
  } as const

  for (const [resource, label] of Object.entries(labels)) {
    const html = renderToStaticMarkup(
      <KubernetesResourceList {...props(resource as KubernetesResourceListProps['resource'])} />,
    )
    expect(html).toContain(label)
  }
})

test('requires a namespace only for namespace-scoped inventories', () => {
  const scoped = props('pods')
  scoped.namespace = ''
  const html = renderToStaticMarkup(<KubernetesResourceList {...scoped} />)
  expect(html).toContain('Select a namespace to browse resources.')

  const clusterScoped = props('nodes')
  clusterScoped.namespace = ''
  expect(renderToStaticMarkup(<KubernetesResourceList {...clusterScoped} />)).toContain(
    'No nodes here.',
  )
})
