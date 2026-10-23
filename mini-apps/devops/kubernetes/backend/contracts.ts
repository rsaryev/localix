/**
 * Kubernetes workbench contracts — the cluster-agnostic shapes the routes + UI share.
 *
 * `ApiKubernetesBackend` produces these from the official Kubernetes JavaScript
 * client. Keeping the shapes here (not in the backend) isolates the UI from the
 * generated Kubernetes API models.
 *
 * Sibling to the container workbench, but Kubernetes has a richer resource model:
 * contexts + namespaces are first-class, so nearly every call carries an
 * optional `context` (selected per API client, NEVER mutating the global kubeconfig)
 * and pod/deployment/service calls carry a `namespace`.
 *
 * This file is the BARREL — the single import surface. The domain shapes live in
 * `contract-types.ts`, the zod request schemas + response bodies in
 * `contract-schemas.ts`, and the live pod-watch frame types in `contract-watch.ts`.
 */
export * from './contract-types'
export * from './contract-schemas'
export * from './contract-watch'
