import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'

// Bound here, not only in the mini app preload: the combined `bun test mini-apps` run loads no
// preload, and another suite's doubles would decide what the problem surface renders.
let unbind = () => {}
beforeEach(() => {
  unbind = bindMiniAppUiTestDoubles()
})
afterEach(() => unbind())
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { KubernetesListHeader } from './KubernetesListHeader'
import { KubernetesResourceBar } from './KubernetesResourceBar'
import { shouldRenderResourceSnapshot } from './KubernetesSidebarInventory'
import { PodRow, PortForwardRow, ServiceRow } from './SidebarRows'
import { PodPortForwards } from './PodPortForwards'
import { PodTabHeader } from './PodTabHeader'

describe('Kubernetes sidebar chrome', () => {
  test('renders one keyboard-selectable resource bar with counts and a failure marker', () => {
    const html = renderToStaticMarkup(
      <KubernetesResourceBar
        value="pods"
        counts={{
          workloads: 15,
          pods: 12,
          deployments: 3,
          services: 4,
          nodes: 2,
          portForwards: 1,
        }}
        errors={{ services: { message: 'forbidden' } }}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('tabindex="-1"')
    expect(html.match(/role="tab"/g)).toHaveLength(6)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('Services temporarily unavailable')
    expect(html).toContain('flex flex-wrap items-center gap-1')
    expect(html).toContain('>Workloads</span>')
    expect(html).toContain('>Forwards</span>')
  })

  test('says a failure in one line and keeps the operator detail in the Event Center', () => {
    const html = renderToStaticMarkup(
      <DevOpsProblem
        subject="Pods"
        issue={{
          code: 'permission_denied',
          message: 'Access denied by Kubernetes RBAC.',
          detail: 'pods is forbidden for User "dev"',
        }}
        onRetry={() => {}}
      />,
    )
    expect(html).toContain('role="alert"')
    // One problem: the RBAC sentence IS the headline — it is the thing a person can act on.
    expect(html).toContain('Access denied by Kubernetes RBAC.')
    expect(html).toContain('>Details</button>')
    expect(html).toContain('>Retry</button>')
    expect(html).not.toContain('is forbidden for User')
    expect(html).not.toContain('bg-status-error')
  })

  // The centring itself is the host `ProblemState`'s (pinned in its own test); what this surface
  // owns is CHOOSING the pane shape — the hand-built `flex-1` wrapper it replaced sat at the top.
  test('uses the host pane shape when the failure is all a pane has to show', () => {
    const html = renderToStaticMarkup(
      <DevOpsProblem
        centered
        subject="Cluster"
        issue={{
          code: 'context_unreachable',
          message: 'Cannot reach this cluster right now.',
          detail: 'ECONNREFUSED 127.0.0.1:6443',
        }}
        onRetry={() => {}}
      />,
    )
    expect(html).toContain('data-problem-shape="state"')
    expect(html).toContain('Cannot reach this cluster right now.')
    expect(html).toContain('>Retry</button>')
    expect(html).not.toContain('ECONNREFUSED')
  })

  test('a stopped local engine offers its start command before Retry', () => {
    const html = renderToStaticMarkup(
      <DevOpsProblem
        centered
        subject="Cluster"
        issue={{
          code: 'context_unreachable',
          message: 'Cannot reach this cluster right now.',
          prerequisite: {
            id: 'docker',
            name: 'Docker Desktop',
            state: 'stopped',
            command: 'open -a Docker',
          },
        }}
        onRetry={() => {}}
      />,
    )
    expect(html).toContain('Docker Desktop is not running')
    // No chat to paste into in this render, so the way out is copying the command.
    expect(html.indexOf('Copy start command')).toBeLessThan(html.indexOf('>Retry<'))
  })

  test('makes a Kubernetes resource row clickable and draggable to the composer', () => {
    const html = renderToStaticMarkup(
      <ServiceRow
        svc={{
          name: 'api',
          namespace: 'apps',
          type: 'ClusterIP',
          clusterIP: '10.0.0.10',
          ports: '80/TCP',
          createdAt: '2026-07-24T00:00:00Z',
        }}
        context="prod"
        onOpen={() => {}}
      />,
    )
    expect(html).toContain('role="listitem" draggable="true"')
    expect(html).toContain('data-resource-uri="localix://resource/k8s/prod/apps/service/api"')
    expect(html).toContain('data-resource-column="meta"')
    expect(html).not.toContain('data-resource-column="link"')
    expect(html).toContain('data-resource-column="action"')
  })

  test('uses one stable metadata and action grid for headers and rows', () => {
    const html = renderToStaticMarkup(
      <KubernetesListHeader primary="Service" secondary="Cluster IP · age" />,
    )
    expect(html).toContain('grid-cols-[minmax(0,1fr)_7rem_4.75rem]')
    expect(html).toContain('@md:grid-cols-[minmax(0,1fr)_11rem_4.75rem]')
    expect(html).not.toContain('>Link<')
    expect(html).toContain('>Actions<')
  })

  test('keeps pod rows compact while exposing status and namespace to assistive tech', () => {
    const html = renderToStaticMarkup(
      <PodRow
        pod={
          {
            name: 'api-7c8d',
            namespace: 'production',
            phase: 'Running',
            ready: '1/1',
            restarts: 0,
            createdAt: '2026-07-24T00:00:00Z',
          } as never
        }
        context="local"
        showNamespace
        busy={false}
        actions={{ onOpen: () => {}, onForward: () => {}, onDeleteRequest: () => {} }}
      />,
    )
    expect(html).toContain('group/row px-3 py-0.5 hover:bg-surface-hover')
    expect(html).toContain('aria-label="api-7c8d, Running, namespace production"')
    expect(html).toContain('>production</span>')
    expect(html).not.toContain('flex-col')
  })

  test('shows a pod-owned forward with its concrete local port and an explicit Stop', () => {
    const html = renderToStaticMarkup(
      <PodPortForwards
        forwards={[
          {
            id: 'forward-1',
            context: 'k3d-localix',
            namespace: 'default',
            pod: 'nginx-test',
            localPort: 49152,
            podPort: 80,
            owner: 'devops:kubernetes-pod:k3d-localix/default/nginx-test',
            createdAt: '2026-07-24T00:00:00Z',
          },
        ]}
        stopping={new Set()}
        onStop={() => {}}
      />,
    )
    expect(html).toContain('Active pod port forwards')
    expect(html).toContain('localhost:49152')
    expect(html).toContain('nginx-test:80')
    expect(html).toContain('Stop localhost:49152 forward')
    expect(html).toContain('>Stop</button>')
    expect(html).toContain('Stops when this pod tab closes')
    expect(html).toContain('Port forward active')
    expect(html).not.toContain('bg-surface-raised')
    expect(html).not.toContain('ring-border')
  })

  test('uses the shared activity language while a pod-owned forward stops', () => {
    const html = renderToStaticMarkup(
      <PodPortForwards
        forwards={[
          {
            id: 'forward-1',
            context: 'k3d-localix',
            namespace: 'default',
            pod: 'nginx-test',
            localPort: 49152,
            podPort: 80,
            owner: 'devops:kubernetes-pod:k3d-localix/default/nginx-test',
            createdAt: '2026-07-24T00:00:00Z',
          },
        ]}
        stopping={new Set(['forward-1'])}
        onStop={() => {}}
      />,
    )
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('lx-activity-orb')
    expect(html).toContain('Stopping')
    expect(html).not.toContain('Stop localhost:49152 forward')
  })

  test('names the concrete listener in the global forward Stop action', () => {
    const html = renderToStaticMarkup(
      <PortForwardRow
        pf={{
          id: 'forward-1',
          context: 'k3d-localix',
          namespace: 'default',
          pod: 'nginx-test',
          localPort: 49152,
          podPort: 80,
          owner: 'devops:kubernetes-pod:k3d-localix/default/nginx-test',
          createdAt: '2026-07-24T00:00:00Z',
        }}
        onOpen={() => {}}
        onStop={() => {}}
      />,
    )
    expect(html).toContain('aria-label="Stop localhost:49152 → nginx-test:80 forward"')
  })

  test('never presents an unconfirmed failed collection as an empty inventory', () => {
    const issue = { code: 'context_unreachable', message: 'offline' }
    expect(shouldRenderResourceSnapshot(issue, 0)).toBe(false)
    expect(shouldRenderResourceSnapshot(issue, 3)).toBe(true)
    expect(shouldRenderResourceSnapshot(null, 0)).toBe(true)
  })

  test('keeps every pod-tab action accessible in the wrapping mobile header', () => {
    const html = renderToStaticMarkup(
      <PodTabHeader
        pod={
          {
            name: 'nginx-test',
            namespace: 'default',
            phase: 'Running',
            containers: ['nginx'],
          } as never
        }
        podName="nginx-test"
        namespace="default"
        context="k3d-localix"
        view="logs"
        setView={() => {}}
        container="nginx"
        setContainer={() => {}}
        running
        busy={false}
        onDeleteRequest={() => {}}
        onExec={() => {}}
        onForward={() => {}}
        onRefresh={() => {}}
      />,
    )
    expect(html).toContain('@max-sm:w-full')
    expect(html).toContain('aria-label="Exec into pod"')
    expect(html).toContain('aria-label="Forward a pod port"')
    expect(html).toContain('aria-label="Delete pod"')
    expect(html).not.toContain('Link nginx-test to chat')
  })
})
