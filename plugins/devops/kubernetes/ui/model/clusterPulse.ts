import type { KubeDeployment, KubeNode, KubePod } from '../../backend/contracts'
import { podHealth } from './groupPods'

export interface ClusterPulse {
  pods: { ready: number; total: number; faults: number }
  deployments: { ready: number; total: number }
  nodes: { ready: number; total: number }
}

export function deploymentIsReady(value: string): boolean {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(value)
  return !!match && Number(match[1]) === Number(match[2])
}

/** Small health snapshot derived from lists we already own. */
export function clusterPulse(
  pods: KubePod[],
  deployments: KubeDeployment[],
  nodes: KubeNode[],
): ClusterPulse {
  const faults = pods.filter((pod) => {
    const health = podHealth(pod)
    return health === 'failed' || health === 'pending'
  }).length
  return {
    pods: { ready: pods.length - faults, total: pods.length, faults },
    deployments: {
      ready: deployments.filter((deployment) => deploymentIsReady(deployment.ready)).length,
      total: deployments.length,
    },
    nodes: { ready: nodes.filter((node) => node.status === 'Ready').length, total: nodes.length },
  }
}
