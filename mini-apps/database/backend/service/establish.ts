/**
 * Establish a validated live driver for a config: resolve `${secret:KEY}` tokens,
 * open the SSH tunnel (when configured), build + probe the driver. Pure factory —
 * the per-user registry/state lives in `live-registry.ts`.
 */
import { hasSecretTokens, resolveSecretTokens } from '@localixai/mini-app-sdk/backend'
import { applyServerReadOnly } from '../read-only/server-guard'
import {
  isFileConnectionConfig,
  isNetworkConnectionConfig,
  type DbConnectionConfig,
} from '../contracts'
import type { DbDriver } from '../drivers/port'
import { mapDbError } from '../errors'
import {
  rewriteConfigForTunnel,
  tunnelTargetFor,
  type openTunnel,
  type TunnelHandle,
} from '../ssh-tunnel'
import type { SavedConnection } from '../store'
import { probeDriver, type LiveEntry } from './live-entry'

/**
 * Narrow read-side secrets capability the service needs to fill `${secret:KEY}` tokens
 * in a connection string at connect time. Declared LOCALLY (not imported from the core
 * secrets subsystem) so this mini app stays decoupled from it — the host adapts its real
 * vault to this shape via the generic mini app `ctx.host.resolveSecret` seam (see
 * `backend/index.ts`). Only `resolve` is used; the secrets grammar helpers
 * (`hasSecretTokens`/`resolveSecretTokens`) are pure and reused directly.
 */
export interface SecretsResolver {
  resolve(userId: string, key: string): Promise<string | null>
}

export interface EstablishDeps {
  createDriver: (config: DbConnectionConfig) => DbDriver | Promise<DbDriver>
  openTunnel: typeof openTunnel
  secretsResolver?: SecretsResolver
}

export function createEstablish(deps: EstablishDeps) {
  /** Return a config with any `${secret:KEY}` tokens resolved — in its connection `url` OR
   *  discrete `password` field, TLS PEM fields, AND (for a network connection) its SSH
   *  `password`/`privateKey`/`passphrase`. Only the live driver + tunnel see resolved creds — the
   *  persisted config keeps the tokens. */
  async function resolveConfigSecrets(
    userId: string,
    config: SavedConnection['config'],
  ): Promise<SavedConnection['config']> {
    const fill = (raw: string) => {
      if (!hasSecretTokens(raw)) return null
      if (!deps.secretsResolver) {
        throw new Error('This connection references a secret, but the secrets store is unavailable')
      }
      return resolveSecretTokens(raw, (key) => deps.secretsResolver!.resolve(userId, key))
    }
    if (isFileConnectionConfig(config)) {
      const resolved = fill(config.file)
      return resolved ? { ...config, file: await resolved } : config
    }
    // Network config: a `${secret:KEY}` token may live in the whole `url`, the discrete
    // `password` field, TLS PEM material, or any SSH credential — resolve all of them so
    // a vaulted credential works in every shape. Only the live driver + tunnel see
    // resolved creds; the stored config keeps tokens.
    const resolveValue = (value: string | undefined): Promise<string | undefined> => {
      if (value === undefined) return Promise.resolve(undefined)
      return fill(value) ?? Promise.resolve(value)
    }
    const ssh = config.ssh
    const ssl = config.ssl && typeof config.ssl === 'object' ? config.ssl : undefined
    const [url, password, sslCa, sslCert, sslKey, sshPassword, privateKey, passphrase] =
      await Promise.all([
        resolveValue(config.url),
        resolveValue(config.password),
        resolveValue(ssl?.ca),
        resolveValue(ssl?.cert),
        resolveValue(ssl?.key),
        resolveValue(ssh?.password),
        resolveValue(ssh?.privateKey),
        resolveValue(ssh?.passphrase),
      ])
    return {
      ...config,
      ...(url !== undefined ? { url } : {}),
      ...(password !== undefined ? { password } : {}),
      ...(ssl
        ? {
            ssl: {
              ...ssl,
              ...(sslCa !== undefined ? { ca: sslCa } : {}),
              ...(sslCert !== undefined ? { cert: sslCert } : {}),
              ...(sslKey !== undefined ? { key: sslKey } : {}),
            },
          }
        : {}),
      ...(ssh
        ? {
            ssh: {
              ...ssh,
              ...(sshPassword !== undefined ? { password: sshPassword } : {}),
              ...(privateKey !== undefined ? { privateKey } : {}),
              ...(passphrase !== undefined ? { passphrase } : {}),
            },
          }
        : {}),
    }
  }

  /** Build + validate a driver for a config (throws a typed {@link DbError} on unreachable/bad
   *  credentials). When the config carries an `ssh` block, open the tunnel FIRST, point the
   *  driver at the local forwarded port, and keep the handle so it closes with the driver.
   *  A tunnel that fails to open throws a typed `ssh_failed` (via `openTunnel`). */
  return async function establish(
    userId: string,
    config: SavedConnection['config'],
  ): Promise<LiveEntry> {
    const resolved = await resolveConfigSecrets(userId, config)
    let tunnel: TunnelHandle | undefined
    try {
      let driverConfig = resolved
      if (isNetworkConnectionConfig(resolved) && resolved.ssh) {
        // tunnelTargetFor / openTunnel throw a typed `ssh_failed` on a bad URL or SSH failure.
        const target = tunnelTargetFor(resolved)
        tunnel = await deps.openTunnel(resolved.ssh, target)
        driverConfig = rewriteConfigForTunnel(resolved, '127.0.0.1', tunnel.localPort)
      }
      const driver = await deps.createDriver(driverConfig)
      try {
        await probeDriver(driver)
      } catch (err) {
        await driver.close().catch(() => {})
        throw mapDbError(err)
      }
      // A read-only connection asks the SERVER to enforce it, not just the text classifier
      // in `../read-only` (whose own header says it is not a security boundary, yet
      // run-query calls it the primary enforcement point). Done once here, right after the
      // probe, so every driver and every caller inherits it. See `read-only/server-guard.ts`
      // for which engines can do this and what it still does not cover; a rejection is
      // reported, never fatal — the classifier guards the path either way.
      const serverReadOnly = config.readonly
        ? await applyServerReadOnly(resolved.dialect, (sql) => driver.query(sql))
        : undefined
      // A rejection is recorded, not logged: `EstablishDeps` has no logger, and widening it
      // for a warning would be the wrong trade. `readonly: true` with
      // `serverReadOnly: false` is a distinguishable state on the live entry, which is what
      // lets a caller tell "the engine is enforcing this" from "only the classifier is".
      // Surfacing that in the connection UI is the follow-up.
      return {
        driver,
        flags: driver.getFlags(),
        readonly: !!config.readonly,
        serverReadOnly: serverReadOnly?.enforced === true,
        inflight: new Map(),
        inflightOperations: new Set(),
        inflightMetadata: new Set(),
        closing: false,
        recentQueries: [],
        tunnel,
      }
    } catch (err) {
      // Crumple zone: ANY failure after the tunnel opened — the driver-config rewrite, a driver
      // constructor that throws synchronously (e.g. mssql's URL parse in `buildMssqlPoolConfig`),
      // or the probe — must release the tunnel, or the SSH child + local 127.0.0.1 listener are
      // orphaned. Released in ONE place, on every throw past `openTunnel`. (`tunnel` is undefined
      // when the throw predates the open — e.g. `tunnelTargetFor` — so this is a no-op then.)
      await tunnel?.close().catch(() => {})
      throw err
    }
  }
}
