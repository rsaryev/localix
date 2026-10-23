/**
 * The log-growth stream on the realtime socket (frame tag `l`), shared by Docker and Kubernetes.
 *
 * A container tab showing live logs re-read the last seconds of output every three seconds, for as
 * long as it was open, whether or not the container printed anything. Both runtimes can follow a
 * log (`docker logs --follow`, the pod log API's `follow=true`); the backend follows it and says
 * when it grew, and the tab reads the new lines then. The frame carries no log text — the reader
 * asks for it through its existing route — and the poll is left for while the stream is down.
 *
 * A leaf with no runtime imports, so the browser bundle can take the constants.
 */
export const LOG_FOLLOW_FRAME_TAG = 'l'
export const DOCKER_LOGS_SUBSCRIBE = 'devops:docker.logs.subscribe'
export const DOCKER_LOGS_UNSUBSCRIBE = 'devops:docker.logs.unsubscribe'
export const KUBE_LOGS_SUBSCRIBE = 'devops:k8s.logs.subscribe'
export const KUBE_LOGS_UNSUBSCRIBE = 'devops:k8s.logs.unsubscribe'

/** At most this many containers are followed for one pod's interleaved view. */
export const MAX_FOLLOWED_CONTAINERS = 16

export type LogFollowFrame =
  | { kind: 'grew'; key: string }
  | { kind: 'status'; key: string; status: 'live' | 'down' }

export interface DockerLogTarget {
  containerId: string
}

export interface KubeLogTarget {
  context: string
  namespace: string
  pod: string
  containers: string[]
}

/** A container id or name as Docker prints it; never an option (`-…`) on the command line. */
const DOCKER_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
/** A Kubernetes object name (DNS subdomain) or container name (DNS label). */
const KUBE_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/

export function dockerLogTarget(params: Record<string, unknown>): DockerLogTarget | null {
  const { containerId } = params
  return typeof containerId === 'string' && DOCKER_REF.test(containerId) ? { containerId } : null
}

export function kubeLogTarget(params: Record<string, unknown>): KubeLogTarget | null {
  const { context, namespace, pod, containers } = params
  if (context !== undefined && typeof context !== 'string') return null
  if (typeof namespace !== 'string' || !KUBE_NAME.test(namespace)) return null
  if (typeof pod !== 'string' || !KUBE_NAME.test(pod)) return null
  if (!Array.isArray(containers) || containers.length === 0) return null
  if (containers.length > MAX_FOLLOWED_CONTAINERS) return null
  if (!containers.every((name) => typeof name === 'string' && KUBE_NAME.test(name))) return null
  return { context: context ?? '', namespace, pod, containers: [...containers] as string[] }
}

/** The one identity a frame is routed by, computed alike on both sides of the socket. */
export function dockerLogKey(target: DockerLogTarget): string {
  return `docker\n${target.containerId}`
}

export function kubeLogKey(target: KubeLogTarget): string {
  return ['k8s', target.context, target.namespace, target.pod, target.containers.join(',')].join(
    '\n',
  )
}
