/** One API event row for a resource. */
export interface KubeEvent {
  /** `Normal` / `Warning`. */
  type: string
  /** e.g. `Scheduled`, `Pulled`, `BackOff`, `Failed`. */
  reason: string
  message: string
  /** How many times this event has fired. */
  count: number
  /** The component that emitted it, e.g. `kubelet`. */
  source: string
  /** ISO timestamp of the last occurrence (the UI derives a relative age). */
  lastSeen: string
}
