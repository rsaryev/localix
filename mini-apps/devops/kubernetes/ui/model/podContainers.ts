import type { KubePod } from '../../backend/contracts'

/**
 * The container selector's option model for the pod tab.
 *
 * The selector must express two cases the previous model could not:
 *
 *  1. INIT containers are selectable. They live in a separate spec field, so a selector
 *     built from `spec.containers` cannot see them — and a pod stuck at `Init:0/1` has no
 *     app-container logs at all, making exactly the state you need logs for undebuggable.
 *  2. ALL containers can be read at once, interleaved. A request the app logged and the
 *     decision the sidecar logged are one story; two separate panes lose the ordering that
 *     is the explanation.
 */

/**
 * Selector value meaning "every container, interleaved".
 *
 * Safe as a sentinel rather than a parallel piece of state: a container name is a DNS label
 * (lowercase alphanumerics and `-`), so `*` can never collide with a real one. One state
 * value also cannot disagree with itself the way a `container` + `allContainers` pair can.
 */
export const ALL_CONTAINERS = '*'

export interface ContainerOption {
  value: string
  label: string
}

/** Every container the API will serve logs for: init containers first, in run order. */
export function podContainerValues(pod: Pick<KubePod, 'containers' | 'initContainers'> | null) {
  return [...(pod?.initContainers ?? []), ...(pod?.containers ?? [])]
}

/**
 * Selector options, or `[]` when there is nothing to choose between.
 *
 * The all-containers entry is offered only when more than one container exists — on a
 * single-container pod it would be a second name for the same output.
 */
export function podContainerOptions(
  pod: Pick<KubePod, 'containers' | 'initContainers'> | null,
): ContainerOption[] {
  const initContainers = pod?.initContainers ?? []
  const containers = pod?.containers ?? []
  if (initContainers.length + containers.length <= 1) return []
  return [
    { value: ALL_CONTAINERS, label: 'All containers' },
    // Labelled, because an init container's logs stop at the moment it exited; reading them
    // as a live stream and wondering why nothing arrives is the trap the label prevents.
    ...initContainers.map((name) => ({ value: name, label: `${name} · init` })),
    ...containers.map((name) => ({ value: name, label: name })),
  ]
}

/**
 * Keep a selection valid across a pod refresh or a watch delta.
 *
 * A container that disappeared (a removed sidecar, or a switch to a different pod) falls
 * back to the pod's first container rather than leaving the selector pointing at a name the
 * pod no longer has, which would silently return no logs. `ALL_CONTAINERS` survives as long
 * as the pod still has containers to interleave.
 */
export function reconcileContainerSelection(
  current: string,
  pod: Pick<KubePod, 'containers' | 'initContainers'> | null,
): string {
  const values = podContainerValues(pod)
  if (current === ALL_CONTAINERS) return values.length > 1 ? ALL_CONTAINERS : (values[0] ?? '')
  if (current && values.includes(current)) return current
  // The first APP container, not the first init container: an init container has already
  // exited on a healthy pod, so defaulting to it would show a dead stream.
  return pod?.containers[0] ?? values[0] ?? ''
}

/** What to send to the logs endpoint for the current selection. */
export function logRequestFor(selection: string): {
  container?: string
  allContainers?: boolean
} {
  return selection === ALL_CONTAINERS
    ? { allContainers: true }
    : { container: selection || undefined }
}

/** How the selection reads in a header, a context label or a download filename. */
export function containerLabel(selection: string): string {
  return selection === ALL_CONTAINERS ? 'all containers' : selection
}
