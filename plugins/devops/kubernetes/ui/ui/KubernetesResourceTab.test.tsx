import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('KubernetesResourceTab startup ownership', () => {
  test('development StrictMode starts one view read and one deployment enrichment', async () => {
    const React = await import('react')
    const { StrictMode, act } = React
    const { createRoot } = await import('react-dom/client')
    const { kubernetesApi } = await import('../api/kubernetesApi')
    const { KubernetesResourceTab } = await import('./KubernetesResourceTab')

    const originalDescribe = kubernetesApi.describeResource.bind(kubernetesApi)
    const originalDeployments = kubernetesApi.listDeployments.bind(kubernetesApi)
    let describeCalls = 0
    let deploymentCalls = 0
    kubernetesApi.describeResource = async () => {
      describeCalls += 1
      return new Promise(() => {})
    }
    kubernetesApi.listDeployments = async () => {
      deploymentCalls += 1
      return new Promise(() => {})
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <KubernetesResourceTab
              resourceKind="deployment"
              name="web"
              namespace="default"
              context="local"
            />
          </StrictMode>,
        )
      })
      expect(describeCalls).toBe(1)
      expect(deploymentCalls).toBe(1)
    } finally {
      await act(async () => root.unmount())
      kubernetesApi.describeResource = originalDescribe
      kubernetesApi.listDeployments = originalDeployments
    }
  })
})
