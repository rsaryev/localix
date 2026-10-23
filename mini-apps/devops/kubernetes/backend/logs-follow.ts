import type { WsFrameContribution } from '@localixai/mini-app-sdk/backend'
import { createLogFollowHub, type LogFollowHub, type LogSource } from '../../backend/log-follow'
import {
  KUBE_LOGS_SUBSCRIBE,
  KUBE_LOGS_UNSUBSCRIBE,
  LOG_FOLLOW_FRAME_TAG,
  kubeLogKey,
  kubeLogTarget,
  type KubeLogTarget,
} from '../../backend/log-follow-contract'
import { createKubeConfig } from './api-internals'
import { kubernetesFetch } from './api-http'

/** Open one container's followed log; resolves to its body, rejects when the API refuses. */
export type FollowContainerLog = (
  target: KubeLogTarget,
  container: string,
  signal: AbortSignal,
) => Promise<ReadableStream<Uint8Array>>

export const kubeFollowPath = (target: KubeLogTarget, container: string) =>
  `/api/v1/namespaces/${encodeURIComponent(target.namespace)}/pods/${encodeURIComponent(
    target.pod,
  )}/log?follow=true&tailLines=0&container=${encodeURIComponent(container)}`

const clusterFollow: FollowContainerLog = async (target, container, signal) => {
  const config = await createKubeConfig(target.context || undefined)
  const cluster = config.getCurrentCluster()
  if (!cluster) throw new Error('No active Kubernetes cluster')
  const response = await kubernetesFetch(
    config,
    cluster.server + kubeFollowPath(target, container),
    {
      method: 'GET',
      signal,
    },
  )
  // A container still waiting to start answers 400; the tab polls until it runs.
  if (!response.ok || !response.body) throw new Error(`log follow returned ${response.status}`)
  return response.body
}

/**
 * The pod log API's `follow=true` for each container the tab shows (several for the interleaved
 * view), with `tailLines=0`: the tab already holds the tail, the stream only says there is more.
 * One abort closes them all.
 */
export function createKubeLogsHub(follow: FollowContainerLog = clusterFollow) {
  return createLogFollowHub<KubeLogTarget>({
    keyOf: kubeLogKey,
    open: async (target): Promise<LogSource> => {
      const controller = new AbortController()
      try {
        const output = await Promise.all(
          target.containers.map((container) => follow(target, container, controller.signal)),
        )
        return { output, close: () => controller.abort() }
      } catch (error) {
        controller.abort()
        throw error
      }
    },
  })
}

export function createKubeLogsWsFrame(hub: LogFollowHub<KubeLogTarget>): WsFrameContribution {
  return {
    subscribeCommand: KUBE_LOGS_SUBSCRIBE,
    unsubscribeCommand: KUBE_LOGS_UNSUBSCRIBE,
    frameTag: LOG_FOLLOW_FRAME_TAG,
    key: (params) => {
      const target = kubeLogTarget(params)
      return target ? kubeLogKey(target) : 'k8s\n'
    },
    start: (params, send) => {
      const target = kubeLogTarget(params)
      if (!target) throw new Error('invalid pod log target')
      return hub.subscribe(target, (frame) => send(JSON.stringify(frame)))
    },
    stop: (handle) => {
      if (typeof handle === 'function') (handle as () => void)()
    },
  }
}
