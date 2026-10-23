import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { initialKubernetesState } from '../model/kubernetesState'
import type { KubernetesWorkbenchModel } from '../model/useKubernetes'
import { KubernetesSidebarView } from './KubernetesSidebar'

function model(state: Partial<KubernetesWorkbenchModel> = {}): KubernetesWorkbenchModel {
  return {
    ...initialKubernetesState,
    autoRetrying: false,
    recoveryPaused: false,
    refresh: async () => {},
    retryBootstrap: () => {},
    setActiveContext: () => {},
    setActiveNamespace: () => {},
    ...state,
  } as KubernetesWorkbenchModel
}

test('composes the standalone Kubernetes header with its loading inventory', () => {
  const html = renderToStaticMarkup(<KubernetesSidebarView kubernetes={model()} />)
  expect(html).toContain('Kubernetes')
  expect(html).toContain('aria-label="Refresh"')
  expect(html).toContain('Loading cluster')
})

test('composes embedded healthy chrome without duplicating the panel header', () => {
  const html = renderToStaticMarkup(
    <KubernetesSidebarView
      embedded
      kubernetes={model({
        loading: false,
        contexts: [{ name: 'local', cluster: 'local', namespace: 'default', current: true }],
        currentContext: 'local',
        activeContext: 'local',
        namespaces: [{ name: 'default', phase: 'Active' }],
        activeNamespace: 'default',
      })}
    />,
  )

  expect(html.match(/aria-label="Refresh"/g)).toHaveLength(1)
  expect(html).toContain('aria-label="Kubernetes resource kinds"')
  expect(html.match(/role="tab"/g)).toHaveLength(6)
  expect(html).toContain('Pods ready')
  expect(html).toContain('No workloads here.')
})
