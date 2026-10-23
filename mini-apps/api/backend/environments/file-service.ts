/**
 * Environment operations over the FILE store — the same {@link EnvironmentService} contract the
 * rest of the mini app already speaks, so nothing above it changed.
 *
 * Two things moved and both are visible here:
 *
 *   1. The records are files in the collection, shared through the repo.
 *   2. "Active" is no longer a field on a record. It is one person's pointer, kept in the mini
 *      app's state directory (see collection/active-environment.ts), because committing it would
 *      let a colleague's `git pull` re-point your next send at their deployment.
 *
 * That second move makes the old "exactly one active" enforcement disappear rather than move: a
 * single-valued pointer cannot have two winners, so the read-then-write loop that used to clear
 * the flag across every record — and could leave two actives if it crashed halfway — is simply
 * gone. Fewer moving parts, and one fewer state that needed repairing.
 *
 * `userId` stays in the signature because the contract has it and every caller passes it, but the
 * collection is scoped by PROJECT: two users on one machine share a checkout, and the pointer is
 * per collection root. Ignoring it here is deliberate, not an oversight.
 */

import { activePairs } from '../request-spec'
import type { ResolveSecret } from '../secrets'
import type { StoreSecret } from '../vault-auth'
import type { BindSecret } from '../vault-bindings'
import { resolveEnvironmentVariable, vaultEnvironmentVariables } from '../environment-vault'
import type { ActiveEnvironmentStore } from '../collection/active-environment'
import type { FileEnvironmentStore, StoredEnvironment } from '../collection/environments'
import type { EnvironmentService } from './service'
import type { SavedEnvironment } from './store'
import { RestError } from '../errors'

interface EnvironmentVault {
  resolveSecret?: ResolveSecret
  storeSecret?: StoreSecret
  bindSecret?: BindSecret
}

/**
 * Mini app discovery may inspect `register()` before the real backend host is attached. A file
 * service is memoized by collection root, so capturing that inspection-time (empty) Vault object
 * would permanently make secret saves fail with 503 even after the native host is available.
 * A provider keeps the filesystem handle memoized while resolving authority at the operation
 * boundary, where it belongs.
 */
type EnvironmentVaultSource = EnvironmentVault | (() => EnvironmentVault)

function currentVault(source?: EnvironmentVaultSource): EnvironmentVault {
  return typeof source === 'function' ? source() : (source ?? {})
}

/**
 * The wire/record shape the rest of the mini app expects, assembled from the file plus the pointer.
 */
function toSaved(environment: StoredEnvironment, activeName: string | null): SavedEnvironment {
  return {
    id: environment.name,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
    active: environment.name === activeName,
    variables: environment.variables,
  }
}

export function createFileEnvironmentService(
  store: FileEnvironmentStore,
  active: ActiveEnvironmentStore,
  collectionRoot: string,
  vault?: EnvironmentVaultSource,
): EnvironmentService {
  const activeName = () => active.get(collectionRoot)

  const activeEnvironment = async (): Promise<StoredEnvironment | null> => {
    const name = await activeName()
    return name === null ? null : store.get(name)
  }

  return {
    async list() {
      const [all, current] = await Promise.all([store.list(), activeName()])
      return all.map((environment) => toSaved(environment, current))
    },

    async get(_userId, name) {
      const [found, current] = await Promise.all([store.get(name), activeName()])
      return found ? toSaved(found, current) : null
    },

    async save(_userId, name, variables) {
      const wasEmpty = (await store.list()).length === 0
      const nativeVault = currentVault(vault)
      const safeVariables = await vaultEnvironmentVariables(
        _userId,
        name,
        variables,
        nativeVault.storeSecret,
        nativeVault.bindSecret,
      )
      const written = await store.save(name, safeVariables)
      if (!written.ok) throw new Error(written.problem)
      // The FIRST environment saved becomes active. Otherwise a user saves one, sends, and gets
      // "variable not defined" — having just created the only thing that could define it.
      if (wasEmpty) await active.set(collectionRoot, written.environment.name)
      return toSaved(written.environment, await activeName())
    },

    async use(_userId, name) {
      const target = await store.get(name)
      if (!target) return null
      await active.set(collectionRoot, target.name)
      return toSaved(target, target.name)
    },

    async deactivate() {
      await active.set(collectionRoot, null)
    },

    async remove(_userId, name) {
      const removed = await store.remove(name)
      // A deleted environment must not stay the active one: the pointer would name a file that is
      // gone, and every send would render against nothing while the UI still showed a selection.
      if (removed && (await activeName()) === name) await active.set(collectionRoot, null)
      return removed
    },

    async rename(_userId, from, to) {
      const wasActive = (await activeName()) === from
      const moved = await store.rename(from, to)
      if (!moved.ok) throw new Error(moved.problem)
      if (wasActive) await active.set(collectionRoot, moved.environment.name)
      return toSaved(moved.environment, await activeName())
    },

    async activeVars(userId, options) {
      const environment = await activeEnvironment()
      if (!environment) return new Map<string, string>()
      // A blank secret is an unconfigured secret, not a value to silently send. Keeping it out of
      // the render map makes the existing template diagnostics name the missing variable before
      // any request reaches the network.
      const pairs = activePairs(
        environment.variables.filter((pair) => !(pair.secret && pair.value === '')),
      )
      if (!options?.resolveSecrets) {
        return new Map(pairs.map((pair) => [pair.name, pair.value]))
      }
      const nativeVault = currentVault(vault)
      if (!nativeVault.resolveSecret) {
        throw new RestError(
          'secret_unavailable',
          'This environment references the native vault, but it is unavailable.',
        )
      }
      const values = await Promise.all(
        pairs.map(
          async (pair) =>
            [
              pair.name,
              await resolveEnvironmentVariable(
                userId,
                environment.name,
                pair,
                nativeVault.resolveSecret!,
              ),
            ] as const,
        ),
      )
      return new Map(values)
    },

    async activeName() {
      // The POINTER alone is not enough: it can name an environment a colleague deleted in a
      // commit you just pulled. Resolving through the store keeps "active" and "exists" the same
      // answer, which is what the render error message assumes when it names the environment.
      return (await activeEnvironment())?.name ?? null
    },
  }
}
