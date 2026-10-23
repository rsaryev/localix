// Presentational row components for the Kubernetes sidebar: a pod row (status dot,
// ready/restarts/age, hover Logs/Forward/Delete with inline confirm), a node row
// (Ready dot, roles/version, Cordon/Uncordon + Drain), and a port-forward row.
// A click anywhere on resource metadata opens details, while the whole row can
// drag the same `@resource:localix://resource/k8s/…` binding into the main input once a context is
// resolved. Stateless — the workspace owns every action + confirm state.
//
// This file is the BARREL — the rows live in `rows/NodeRow.tsx`, `rows/PodRow.tsx`,
// and `rows/WorkloadRows.tsx` (deployment / service / port-forward).
export { NODE_ACTION_META, NodeRow, type NodeAction, type NodeRowActions } from './rows/NodeRow'
export { PodRow, type PodRowActions } from './rows/PodRow'
export { DeploymentRow, PortForwardRow, ServiceRow } from './rows/WorkloadRows'
