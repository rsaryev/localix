import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { NodeUsage, PortForward } from '../../backend/contracts'
import { initialKubernetesState, type KubernetesState } from './kubernetesState'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const node = (name: string): NodeUsage => ({ name, cpuNanos: 1, memoryBytes: 1 })

describe('live usage', () => {
  test('stops showing the last numbers when polling stops, and does not bring them back', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { kubernetesApi } = await import('../api/kubernetesApi')
    const { useUsageMetrics } = await import('./useUsageMetrics')
    const original = kubernetesApi.nodeMetrics.bind(kubernetesApi)
    let answer: Promise<NodeUsage[] | null> = Promise.resolve([node('n1')])
    kubernetesApi.nodeMetrics = () => answer
    let shown: ReadonlyMap<string, NodeUsage> = new Map()

    function Probe({ enabled }: { enabled: boolean }) {
      const { nodeUsage } = useUsageMetrics({
        enabled,
        context: 'ctx',
        namespace: '',
        wantPods: false,
        wantNodes: true,
      })
      useEffect(() => {
        shown = nodeUsage
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe enabled />))
      expect([...shown.keys()]).toEqual(['n1'])

      await act(async () => root.render(<Probe enabled={false} />))
      expect(shown.size).toBe(0)

      // Back on, the next answer is still on its way: nothing from before is shown meanwhile.
      answer = new Promise(() => {})
      await act(async () => root.render(<Probe enabled />))
      expect(shown.size).toBe(0)
    } finally {
      await act(async () => root.unmount())
      kubernetesApi.nodeMetrics = original
    }
  })
})

describe('automatic recovery', () => {
  test('announces a retry while a failure is open and stops once nothing is failing', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { useKubernetesRecovery } = await import('./useKubernetesRecovery')
    const failing: KubernetesState = {
      ...initialKubernetesState,
      loading: false,
      error: { message: 'connection reset' },
    }
    const healthy: KubernetesState = { ...initialKubernetesState, loading: false }
    let result!: ReturnType<typeof useKubernetesRecovery>

    function Probe({ state }: { state: KubernetesState }) {
      const recovery = useKubernetesRecovery({
        enabled: true,
        state,
        bootstrap: async () => true,
        refresh: async () => {},
      })
      useEffect(() => {
        result = recovery
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe state={failing} />))
      expect(result.autoRetrying).toBe(true)
      expect(result.liveReadsEnabled).toBe(false)

      await act(async () => root.render(<Probe state={healthy} />))
      expect(result.autoRetrying).toBe(false)
      expect(result.liveReadsEnabled).toBe(true)

      // The same failure coming back starts its retries afresh.
      await act(async () => root.render(<Probe state={failing} />))
      expect(result.autoRetrying).toBe(true)
      expect(result.recoveryPaused).toBe(false)
    } finally {
      await act(async () => root.unmount())
    }
  })
})

describe('pod port forwards', () => {
  test('a shown tab lists only the forwards it owns', async () => {
    const React = await import('react')
    const { act, useEffect } = React
    const { createRoot } = await import('react-dom/client')
    const { kubernetesApi } = await import('../api/kubernetesApi')
    const { usePodPortForwards } = await import('./usePodPortForwards')
    const forward = (id: string, owner: string): PortForward => ({
      id,
      namespace: 'default',
      pod: 'web',
      localPort: 8080,
      podPort: 80,
      context: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      owner,
    })
    const original = kubernetesApi.listPortForwards.bind(kubernetesApi)
    kubernetesApi.listPortForwards = async () => [forward('a', 'tab-1'), forward('b', 'tab-2')]
    let ids: string[] = []

    function Probe({ active }: { active: boolean }) {
      const { forwards } = usePodPortForwards(active, 'tab-1')
      useEffect(() => {
        ids = forwards.map((candidate) => candidate.id)
      })
      return null
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Probe active={false} />))
      expect(ids).toEqual([])
      await act(async () => root.render(<Probe active />))
      expect(ids).toEqual(['a'])
    } finally {
      await act(async () => root.unmount())
      kubernetesApi.listPortForwards = original
    }
  })
})
