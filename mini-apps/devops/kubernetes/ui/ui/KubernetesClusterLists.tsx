import { useMemo } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'

import { ALL_NAMESPACES } from '../../backend/contracts'
import {
  openKubernetesNodeTab,
  openKubernetesPodTab,
  openKubernetesResourceTab,
} from '../model/openTab'
import {
  sortKubeDeployments,
  sortKubeNodes,
  sortKubePortForwards,
  sortKubeServices,
} from '../model/sortResources'
import { nodeUsageDisplay } from '../model/usage'
import { KubernetesListHeader } from './KubernetesListHeader'
import {
  DeploymentRow,
  NodeRow,
  type NodeRowActions,
  PortForwardRow,
  ServiceRow,
} from './SidebarRows'
import { EmptyResource, matchesResourceQuery } from './resourceListPresentation'
import type { KubernetesResourceListProps } from './resourceListTypes'

/*
 * Every row here opens a SESSION tab (a pod tab's Exec shells into a chat's terminal; a
 * node/deployment/service tab opens pod tabs), so each list opens it in the chat of the workspace
 * it is drawn in. With no chat there is nowhere to open it, and the click does nothing.
 */

export function KubernetesDeploymentsList(props: KubernetesResourceListProps) {
  const sessionId = useWorkItemSessionId()
  const visible = sortKubeDeployments(
    props.deployments.filter((deployment) =>
      matchesResourceQuery(props.query, deployment.name, deployment.namespace, deployment.ready),
    ),
    props.sort,
  )
  if (!visible.length) {
    return <EmptyResource resource="deployments" filtered={!!props.query.trim()} />
  }
  return (
    <>
      <KubernetesListHeader primary="Deployment / namespace" secondary="Ready · age" />
      <div role="list" aria-label="Deployments">
        {visible.map((deployment) => (
          <DeploymentRow
            key={`${deployment.namespace}/${deployment.name}`}
            dep={deployment}
            context={props.context}
            showNamespace={props.namespace === ALL_NAMESPACES}
            onOpen={() => {
              if (!sessionId) return
              openKubernetesResourceTab(
                sessionId,
                'deployment',
                deployment.name,
                deployment.namespace,
                props.context,
              )
            }}
            onScale={() => props.onScale(deployment)}
            onRestart={() => props.onRestart(deployment)}
          />
        ))}
      </div>
    </>
  )
}

export function KubernetesServicesList(props: KubernetesResourceListProps) {
  const sessionId = useWorkItemSessionId()
  const visible = sortKubeServices(
    props.services.filter((service) =>
      matchesResourceQuery(
        props.query,
        service.name,
        service.namespace,
        service.type,
        service.clusterIP,
        service.ports,
      ),
    ),
    props.sort,
  )
  if (!visible.length) {
    return <EmptyResource resource="services" filtered={!!props.query.trim()} />
  }
  return (
    <>
      <KubernetesListHeader primary="Service / type / ports" secondary="Cluster IP · age" />
      <div role="list" aria-label="Services">
        {visible.map((service) => (
          <ServiceRow
            key={`${service.namespace}/${service.name}`}
            svc={service}
            context={props.context}
            showNamespace={props.namespace === ALL_NAMESPACES}
            onOpen={() => {
              if (!sessionId) return
              openKubernetesResourceTab(
                sessionId,
                'service',
                service.name,
                service.namespace,
                props.context,
              )
            }}
          />
        ))}
      </div>
    </>
  )
}

export function KubernetesNodesList(props: KubernetesResourceListProps) {
  // A cluster can list dozens of nodes; one bundle keeps every unchanged row's props
  // identical between the 8s secondary polls.
  const { context, onNodeAction } = props
  const sessionId = useWorkItemSessionId()
  const nodeActions = useMemo<NodeRowActions>(
    () => ({
      onOpen: (node) => {
        if (sessionId) openKubernetesNodeTab(sessionId, node, context)
      },
      onCordon: (node) => onNodeAction(node, 'cordon'),
      onUncordon: (node) => onNodeAction(node, 'uncordon'),
      onDrain: (node) => onNodeAction(node, 'drain'),
    }),
    [sessionId, context, onNodeAction],
  )
  const visible = sortKubeNodes(
    props.nodes.filter((node) =>
      matchesResourceQuery(props.query, node.name, node.status, node.roles.join(' '), node.version),
    ),
    props.sort,
  )
  if (!visible.length) {
    return <EmptyResource resource="nodes" filtered={!!props.query.trim()} />
  }
  return (
    <>
      <KubernetesListHeader primary="Node / roles / version" secondary="Status · age" />
      <div role="list" aria-label="Nodes">
        {visible.map((node) => (
          <NodeRow
            key={node.name}
            node={node}
            context={props.context}
            usage={nodeUsageDisplay(node, props.nodeUsage.get(node.name))}
            actions={nodeActions}
          />
        ))}
      </div>
    </>
  )
}

export function KubernetesPortForwardsList(props: KubernetesResourceListProps) {
  const sessionId = useWorkItemSessionId()
  const visible = sortKubePortForwards(
    props.portForwards.filter((forward) =>
      matchesResourceQuery(
        props.query,
        forward.pod,
        forward.namespace,
        String(forward.localPort),
        String(forward.podPort),
      ),
    ),
    props.sort,
  )
  if (!visible.length) {
    return <EmptyResource resource="portForwards" filtered={!!props.query.trim()} />
  }
  return (
    <>
      <KubernetesListHeader primary="Pod / namespace" secondary="Local → pod · age" />
      <div role="list" aria-label="Port forwards">
        {visible.map((forward) => (
          <PortForwardRow
            key={forward.id}
            pf={forward}
            context={props.context}
            onOpen={() => {
              if (!sessionId) return
              openKubernetesPodTab(
                sessionId,
                forward.pod,
                forward.namespace,
                forward.context || props.context || undefined,
              )
            }}
            onStop={() => props.onStopForward(forward.id)}
          />
        ))}
      </div>
    </>
  )
}
