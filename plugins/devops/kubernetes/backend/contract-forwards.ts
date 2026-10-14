/** A live, service-managed API port-forward. */

/** A live Kubernetes API port-forward managed by the service (in-memory only —
 *  forwards do NOT survive an application restart). */
export interface PortForward {
  /** Opaque id assigned by the service (stop/list key). */
  id: string
  namespace: string
  pod: string
  /** Local end (`127.0.0.1:<localPort>`). */
  localPort: number
  /** Container/pod port being forwarded to. */
  podPort: number
  /** The kube context this forward runs against (empty ⇒ current-context). */
  context: string
  createdAt: string
  /** Opaque owner tag (e.g. the pod tab's WorkItem id) — a forward started from a
   *  transient surface is torn down when that surface closes. Empty ⇒ unowned
   *  (started from the always-present sidebar), so it survives until stopped by hand. */
  owner: string
}
