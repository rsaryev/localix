/**
 * Kubernetes workbench domain shapes — the BARREL over the per-domain contract
 * files. Import `contracts.ts` (which re-exports this) rather than a domain file, so
 * moving a shape between domains stays invisible to callers.
 */
export * from './contract-cluster'
export * from './contract-pods'
export * from './contract-nodes'
export * from './contract-usage'
export * from './contract-workloads'
export * from './contract-generic'
export * from './contract-manifests'
export * from './contract-events'
export * from './contract-forwards'
