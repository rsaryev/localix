/**
 * Pod shapes: phase, the forwardable ports a pod advertises, the list row, and the
 * text payloads a pod tab renders (logs, describe).
 */

/** A pod's high-level phase, normalised to Kubernetes' canonical set. */
export type PodPhase = 'Running' | 'Pending' | 'Succeeded' | 'Failed' | 'Unknown'

export type KubePortProbe = 'readiness' | 'startup' | 'liveness'

/** One TCP port that Kubernetes can forward into the pod network namespace. */
export interface KubeContainerPort {
  /** App container that declared the port (or owns the probe that references it). */
  container: string
  /** Optional Kubernetes port name, e.g. `http`, `grpc`, or `debug`. */
  name: string
  port: number
  protocol: 'TCP'
  /** Strong runtime-intent signal; unlike `containerPort`, a probe is expected to answer. */
  probe: KubePortProbe | null
}

/** One API-derived pod row (ready/restarts/age at a glance). */
export interface KubePod {
  /** Kubernetes object identity. Unlike name, this survives all-namespaces lists
   * without collisions and changes when a deleted pod is recreated. */
  uid: string
  /** Opaque API revision used to reject stale watch frames. */
  resourceVersion: string
  name: string
  namespace: string
  phase: PodPhase
  /** `"1/2"` ready-containers display. */
  ready: string
  readyCount: number
  totalCount: number
  /** Total restart count across the pod's containers. */
  restarts: number
  node: string
  podIP: string
  /** Creation timestamp (ISO); the UI derives a relative age from it. */
  createdAt: string
  /** Container names, for the log-viewer container selector. */
  containers: string[]
  /**
   * Init-container names (`spec.initContainers`), which are NOT in `containers`.
   *
   * Selectable for logs on purpose: a pod stuck at `Init:0/1` is precisely when its init
   * container's output is the only thing that explains the pod, and omitting them from the
   * selector makes that state undebuggable here.
   */
  initContainers: string[]
  /**
   * Port-forwardable TCP ports with their container/name/probe metadata.
   *
   * A declaration alone does not mean a process is listening. The dialog therefore uses probe
   * metadata for its recommendation instead of silently selecting the first number.
   */
  containerPorts: KubeContainerPort[]
  /** A waiting/terminated reason if the pod is unhealthy, e.g. `CrashLoopBackOff`. */
  reason: string
  /**
   * CPU the scheduler has RESERVED for this pod, in nanocores — the sum of its
   * containers' `resources.requests.cpu`.
   *
   * A different question from live usage, and answerable on a cluster with no
   * metrics-server at all, because it comes from the pod spec. It is also the number
   * that explains an unschedulable pod: a node can sit at 15% measured CPU while 100%
   * of its allocatable is already requested. `0` when nothing is requested, which is
   * itself the answer (a pod with no requests is best-effort).
   */
  requestedCpuNanos: number
  /** Memory the scheduler has reserved, in bytes. Same reasoning. */
  requestedMemoryBytes: number
}

/** A pod's logs (tail N, optional container), returned as one text blob. */
export interface PodLogs {
  pod: string
  lines: string
}

/** A pod's identity header and canonical YAML as text. */
export interface PodDescribe {
  pod: string
  text: string
}
