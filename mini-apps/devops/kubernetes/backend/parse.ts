/**
 * Pure parsers for serialized Kubernetes API objects: a List with an `items` array,
 * one resource, or kubeconfig JSON. Malformed/empty input yields an empty list rather
 * than throwing, so a transient blip never crashes the sidebar.
 *
 * This file is the BARREL — the single import surface. The shared coercers live in
 * `parse-core.ts`, the pod parsers in `parse-pods.ts`, the cluster-scope parsers
 * (contexts/namespaces/nodes) in `parse-cluster.ts`, and the workload parsers
 * (deployments/services/events) in `parse-workloads.ts`.
 */
export { parsePod, parsePods } from './parse-pods'
export { parseContexts, parseNamespaces, parseNodes } from './parse-cluster'
export {
  buildLabelSelector,
  parseDeployments,
  parseDeploymentSelector,
  parseEvents,
  parseServices,
} from './parse-workloads'
