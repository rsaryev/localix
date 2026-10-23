import { expect, test } from 'bun:test'

import type {
  MiniAppUiHost,
  UiAnchorContribution,
  WorkItemKindContribution,
} from '@localixai/mini-app-sdk/ui'
import { registerKubernetesContributions } from './register'

test('live Kubernetes tabs stay transient and expose native agent context bindings', () => {
  const workItems: WorkItemKindContribution[] = []
  const anchors: UiAnchorContribution[] = []
  const noop = { register: () => {} }
  const host = {
    workItems: { register: (item: WorkItemKindContribution) => workItems.push(item) },
    railSections: noop,
    railViewlets: noop,
    search: noop,
    anchors: {
      register: (anchor: UiAnchorContribution) => {
        anchors.push(anchor)
        return true
      },
    },
    resourceRefIcons: noop,
    fileEditors: noop,
    fileFormats: noop,
    sessionEvents: noop,
  } as unknown as MiniAppUiHost

  registerKubernetesContributions(host)

  for (const kind of ['devops:kubernetes-pod', 'devops:kubernetes-resource']) {
    const item = workItems.find((candidate) => candidate.kind === kind)
    expect(item?.restorable).toBe(false)
    // Session kinds: a pod tab shells into its chat's terminal, a resource tab opens pod tabs there.
    expect(item?.scope).toBeUndefined()
  }

  const pod = workItems.find((item) => item.kind === 'devops:kubernetes-pod')
  expect(
    pod?.toMessageBinding?.(
      {
        kind: 'devops:kubernetes-pod',
        id: 'pod',
        title: 'api-0',
        payload: { podName: 'api-0', namespace: 'prod', context: 'cluster-a' },
      },
      { session: null },
    ),
  ).toMatchObject({
    target: { uri: 'localix://resource/k8s/cluster-a/prod/api-0', label: 'api-0' },
  })

  const resource = workItems.find((item) => item.kind === 'devops:kubernetes-resource')
  expect(
    resource?.toMessageBinding?.(
      {
        kind: 'devops:kubernetes-resource',
        id: 'deployment',
        title: 'api',
        payload: {
          resourceKind: 'deployment',
          name: 'api',
          namespace: 'prod',
          context: 'cluster-a',
        },
      },
      { session: null },
    ),
  ).toMatchObject({
    target: { uri: 'localix://resource/k8s/cluster-a/prod/deployment/api', label: 'api' },
  })
  expect(
    resource?.toMessageBinding?.(
      {
        kind: 'devops:kubernetes-resource',
        id: 'node',
        title: 'worker-1',
        payload: {
          resourceKind: 'node',
          name: 'worker-1',
          namespace: '',
          context: 'cluster-a',
        },
      },
      { session: null },
    ),
  ).toMatchObject({
    target: { uri: 'localix://resource/k8s/cluster-a/node/worker-1', label: 'worker-1' },
  })

  expect(anchors[0]?.resolve('localix://resource/k8s/cluster-a/node')).toMatchObject({
    kind: 'work-item',
    workKind: 'devops:workspace',
    id: 'devops:workspace',
    payload: { area: 'kubernetes', kubernetesResource: 'nodes' },
  })
  expect(anchors[0]?.resolve('localix://resource/k8s/cluster-a/node/worker-1')).toMatchObject({
    kind: 'work-item',
    workKind: 'devops:kubernetes-resource',
    payload: { resourceKind: 'node', name: 'worker-1' },
  })
})
