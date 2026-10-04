import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { KubePod } from '../../backend/contracts'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

function pod(probed = true, name = 'api-6764489966-rgc4n'): KubePod {
  return {
    uid: 'uid-api',
    resourceVersion: '1',
    name,
    namespace: 'apps',
    phase: 'Running',
    ready: '1/1',
    readyCount: 1,
    totalCount: 1,
    restarts: 0,
    node: 'node-1',
    podIP: '10.0.0.5',
    createdAt: '2026-07-28T04:00:46Z',
    containers: ['service'],
    initContainers: [],
    containerPorts: [
      { container: 'service', name: 'debug', port: 4444, protocol: 'TCP', probe: null },
      { container: 'service', name: 'grpc', port: 5000, protocol: 'TCP', probe: null },
      {
        container: 'service',
        name: 'http',
        port: 4000,
        protocol: 'TCP',
        probe: probed ? 'readiness' : null,
      },
    ],
    reason: '',
    requestedCpuNanos: 0,
    requestedMemoryBytes: 0,
  }
}

describe('Forward a pod port dialog', () => {
  test('shows the target, recommended probe port, and explicit local-to-pod mapping', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { PortForwardDialog } = await import('./PortForwardDialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <PortForwardDialog pod={pod()} namespace="apps" context="staging" onClose={() => {}} />,
        )
      })

      const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!
      expect(dialog.textContent).toContain('Forward a pod port')
      expect(dialog.textContent).toContain('api-6764489966-rgc4n')
      expect(dialog.textContent).toContain('http · 4000')
      expect(dialog.textContent).toContain('Recommended')
      expect(dialog.textContent).toContain('readiness probe')
      expect(dialog.textContent).toContain('127.0.0.1:automatic')
      expect(dialog.textContent).toContain('api-6764489966-rgc4n:4000')
      expect(
        Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          button.textContent?.includes('Start forward'),
        )?.disabled,
      ).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('does not silently choose among ambiguous unprobed declarations', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { PortForwardDialog } = await import('./PortForwardDialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<PortForwardDialog pod={pod(false)} namespace="apps" onClose={() => {}} />)
      })

      const dialog = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!
      expect(dialog.textContent).toContain('Choose a pod port…')
      expect(dialog.textContent).not.toContain('Recommended')
      expect(
        Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          button.textContent?.includes('Start forward'),
        )?.disabled,
      ).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps entered ports when a watch replaces the same pod snapshot', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { PortForwardDialog } = await import('./PortForwardDialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(<PortForwardDialog pod={pod()} namespace="apps" onClose={() => {}} />)
      })
      const localPort = document.querySelector<HTMLInputElement>('input[placeholder="Automatic"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          localPort,
          '49152',
        )
        localPort.dispatchEvent(new Event('input', { bubbles: true }))
      })

      await act(async () => {
        root.render(<PortForwardDialog pod={pod()} namespace="apps" onClose={() => {}} />)
      })

      expect(
        document.querySelector<HTMLInputElement>('input[placeholder="Automatic"]')?.value,
      ).toBe('49152')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('stops a late forward when the dialog target changes before start completes', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { kubernetesApi } = await import('../api/kubernetesApi')
    const { PortForwardDialog } = await import('./PortForwardDialog')
    const originalStart = kubernetesApi.startPortForward.bind(kubernetesApi)
    const originalStop = kubernetesApi.stopPortForward.bind(kubernetesApi)
    let resolveStart!: (value: Awaited<ReturnType<typeof originalStart>>) => void
    const started: string[] = []
    const stopped: string[] = []
    kubernetesApi.startPortForward = () =>
      new Promise((resolve) => {
        resolveStart = resolve
      })
    kubernetesApi.stopPortForward = async (id) => {
      stopped.push(id)
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <PortForwardDialog
            pod={pod()}
            namespace="apps"
            onClose={() => {}}
            onStarted={(forward) => started.push(forward.id)}
          />,
        )
      })
      const start = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent?.includes('Start forward'),
      )!
      await act(async () => start.click())

      await act(async () => {
        root.render(
          <PortForwardDialog
            pod={pod(true, 'worker-0')}
            namespace="apps"
            onClose={() => {}}
            onStarted={(forward) => started.push(forward.id)}
          />,
        )
      })
      await act(async () => {
        resolveStart({
          id: 'late-forward',
          namespace: 'apps',
          pod: 'api-6764489966-rgc4n',
          localPort: 49152,
          podPort: 4000,
          context: '',
          createdAt: '2026-07-28T00:00:00Z',
          owner: '',
        })
        await Promise.resolve()
      })

      expect(started).toEqual([])
      expect(stopped).toEqual(['late-forward'])
    } finally {
      kubernetesApi.startPortForward = originalStart
      kubernetesApi.stopPortForward = originalStop
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
