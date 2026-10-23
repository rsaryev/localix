/**
 * Process-wide holder for this mini app's store + secret resolver.
 *
 * `register()` runs MORE THAN ONCE per process: once at boot (the backend/host-service load) and
 * again per agent run (the tool contribution, via the per-run mini app loader). Only the BOOT load
 * carries `ctx.host`, so the per-run load that actually owns the `api_client` tool has no way
 * to resolve `${secret:KEY}` on its own. Holding the resolver on `globalThis` — which survives
 * the fresh per-call module import the loader does — is what lets the tool reach the vault.
 *
 * The latest real host always wins, and a load without one never clears it.
 */

import type { ResolveSecret } from './secrets'
import type { StoreSecret } from './vault-auth'
import type { BindSecret } from './vault-bindings'

interface Holder {
  resolveSecret?: ResolveSecret
  storeSecret?: StoreSecret
  bindSecret?: BindSecret
}

const GLOBAL_KEY = Symbol.for('localix.mini-app.api.services')

function holder(): Holder {
  const g = globalThis as { [key: symbol]: Holder | undefined }
  return (g[GLOBAL_KEY] ??= {})
}

/** Bind the host's vault seams. Called by the boot load; each half is a no-op when absent. */
export function bindVault(seams: {
  resolveSecret?: ResolveSecret
  storeSecret?: StoreSecret
  bindSecret?: BindSecret
}): void {
  const h = holder()
  if (seams.resolveSecret) h.resolveSecret = seams.resolveSecret
  if (seams.storeSecret) h.storeSecret = seams.storeSecret
  if (seams.bindSecret) h.bindSecret = seams.bindSecret
}

/** The LATEST bound binder, or undefined when the host offers no binding registry. */
export function getBindSecret(): BindSecret | undefined {
  const h = holder()
  return h.bindSecret ? (...args) => h.bindSecret!(...args) : undefined
}

/**
 * The LATEST bound writer, or undefined when no host ever bound one.
 *
 * Undefined is meaningful and must stay distinguishable from "a writer that always fails": the
 * import path uses it to decide whether vaulting is even possible, and a stub that silently
 * refused would make every import report a collision it never had.
 */
export function getStoreSecret(): StoreSecret | undefined {
  const h = holder()
  return h.storeSecret ? (...args) => h.storeSecret!(...args) : undefined
}

/**
 * Read the LATEST bound resolver, so a store first requested by a per-run tool load (which had
 * no host) still resolves secrets once the boot load has bound the real one.
 *
 * `consumer` is forwarded: dropping it attributed every vault read to "api" as a whole, so the
 * vault's activity log could not say WHICH saved request read a secret.
 */
export function getResolveSecret(): ResolveSecret {
  return (userId, key, consumer) =>
    holder().resolveSecret?.(userId, key, consumer) ?? Promise.resolve(null)
}
