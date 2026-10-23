import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { KubePod } from '../../backend/contracts'
import type { KubernetesResourceTabModel } from '../model/useKubernetesResourceTab'
import { KubernetesResourceContent } from './KubernetesResourceContent'
import { KubernetesResourceHeader } from './KubernetesResourceHeader'

function model(overrides: Partial<KubernetesResourceTabModel> = {}): KubernetesResourceTabModel {
  return {
    view: 'describe',
    setView: () => {},
    describe: '',
    events: [],
    pods: [],
    deployment: null,
    scaling: false,
    openScale: () => {},
    closeScale: () => {},
    loading: false,
    error: null,
    resourceUri: 'localix://resource/k8s/local/apps/deployment/web',
    resolvedContext: 'local',
    refresh: async () => {},
    loadDeployment: async () => {},
    ...overrides,
  } as KubernetesResourceTabModel
}

test('deployment header exposes Pods and Scale while service header does not', () => {
  const deployment = renderToStaticMarkup(
    <KubernetesResourceHeader
      model={model()}
      resourceKind="deployment"
      name="web"
      namespace="apps"
      context="local"
    />,
  )
  const service = renderToStaticMarkup(
    <KubernetesResourceHeader
      model={model({ resourceUri: 'localix://resource/k8s/local/apps/service/web' })}
      resourceKind="service"
      name="web"
      namespace="apps"
      context="local"
    />,
  )

  expect(deployment).toContain('>Pods</button>')
  expect(deployment).toContain('aria-label="Scale deployment"')
  expect(service).not.toContain('>Pods</button>')
  expect(service).not.toContain('aria-label="Scale deployment"')
})

test('manifest view removes the redundant refresh action', () => {
  const html = renderToStaticMarkup(
    <KubernetesResourceHeader
      model={model({ view: 'manifest' })}
      resourceKind="deployment"
      name="web"
      namespace="apps"
    />,
  )
  expect(html).not.toContain('aria-label="Refresh"')
})

test('owned pods use the compact relation grid with no empty Actions or Link columns', () => {
  const pod = {
    name: 'web-0',
    namespace: 'apps',
    phase: 'Running',
    ready: '1/1',
    restarts: 0,
    createdAt: '2026-07-28T00:00:00Z',
  } as KubePod
  const html = renderToStaticMarkup(
    <KubernetesResourceContent
      model={model({ view: 'pods', pods: [pod] })}
      resourceKind="deployment"
      name="web"
      namespace="apps"
      context="local"
    />,
  )
  expect(html).toContain('grid-cols-[minmax(0,1fr)_7rem]')
  expect(html).toContain('role="listitem" draggable="true"')
  expect(html).not.toContain('>Actions<')
  expect(html).not.toContain('data-resource-column="link"')
  expect(html).not.toContain('data-resource-column="action"')
})
