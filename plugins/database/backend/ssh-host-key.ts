/**
 * Trust-on-first-use for the SSH bastion's host key.
 *
 * ssh2 accepts ANY server key unless it is given a `hostVerifier`, so the tunnel used to
 * authenticate to whoever answered on the bastion's address: a machine on the path could
 * stand in for it, collect the SSH password (or, with key auth, read every byte of database
 * traffic inside the tunnel, the database password included). The fix is the one OpenSSH
 * makes with `known_hosts`: remember the key the first time, refuse a different one after.
 *
 * Three decisions live here, in the order a connect meets them:
 *  1. which pin a config carries into the connect (`reconcileHostKeyPin`) — a pin belongs to
 *     ONE bastion, so moving the bastion drops it;
 *  2. whether the presented key passes (`createHostKeyCheck`);
 *  3. what gets persisted after a successful connect (`pinObservedHostKey`).
 */
import { createHash } from 'node:crypto'
import { isNetworkConnectionConfig, type DbConnectionConfig } from './contracts'
import { DbError } from './errors'

/** OpenSSH's fingerprint of a raw public-key blob: `SHA256:` + unpadded base64. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export interface HostKeyCheck {
  /** ssh2's `hostVerifier` (raw key form — no `hostHash`). */
  verify(key: Buffer): boolean
  /** The fingerprint the server presented, once it has. */
  observed(): string | undefined
  /** When the presented key did not match the pin: the typed error to reject with. */
  mismatch(): DbError | undefined
}

export function createHostKeyCheck(host: string, pinned: string | undefined): HostKeyCheck {
  let seen: string | undefined
  let refused: DbError | undefined
  return {
    verify(key) {
      seen = hostKeyFingerprint(key)
      if (!pinned || seen === pinned) return true
      refused = new DbError(
        'ssh_failed',
        `The SSH host key of ${host} changed: expected ${pinned}, got ${seen}. ` +
          'This can mean someone is intercepting the connection. If the bastion was ' +
          'legitimately re-keyed, open the connection, choose "Forget host key" in the SSH ' +
          'settings and connect again to trust the new key.',
      )
      return false
    },
    observed: () => seen,
    mismatch: () => refused,
  }
}

type Bastion = { host: string; port?: number | undefined }
const sameBastion = (a: Bastion, b: Bastion) =>
  a.host.trim().toLowerCase() === b.host.trim().toLowerCase() && (a.port ?? 22) === (b.port ?? 22)

function withPin(config: DbConnectionConfig, pin: string | undefined): DbConnectionConfig {
  if (!isNetworkConnectionConfig(config) || !config.ssh) return config
  const { hostKeyFingerprint: _old, ...ssh } = config.ssh
  return { ...config, ssh: pin ? { ...ssh, hostKeyFingerprint: pin } : ssh }
}

/**
 * The pin `next` should connect with, given the saved `previous`.
 *
 *  - A different bastion (host or port) never inherits a pin: that key belongs to another
 *    machine, and checking the new one against it would refuse a correct connect forever.
 *  - `inherit`: a fresh connect folding onto a saved target keeps the saved pin — the form
 *    that sent it never saw the pin, and dropping it would silently re-trust whatever answers.
 *    An EDIT does not inherit: the edit form round-trips the pin, so its absence there is the
 *    user's "Forget host key".
 */
export function reconcileHostKeyPin(
  previous: DbConnectionConfig | undefined,
  next: DbConnectionConfig,
  opts: { inherit: boolean },
): DbConnectionConfig {
  if (!isNetworkConnectionConfig(next) || !next.ssh) return next
  const prevSsh = previous && isNetworkConnectionConfig(previous) ? previous.ssh : undefined
  if (!prevSsh || !sameBastion(prevSsh, next.ssh)) {
    // No saved bastion to compare against: keep what the caller sent (a test of a saved edit,
    // an agent reconnect). A moved bastion: drop whatever pin rode along.
    return prevSsh ? withPin(next, undefined) : next
  }
  if (next.ssh.hostKeyFingerprint || !opts.inherit) return next
  return withPin(next, prevSsh.hostKeyFingerprint)
}

/** After a successful connect: the config to persist, with the observed key pinned if unpinned. */
export function pinObservedHostKey(
  config: DbConnectionConfig,
  observed: string | undefined,
): DbConnectionConfig {
  const ssh = isNetworkConnectionConfig(config) ? config.ssh : undefined
  // Only a tunnel with no pin yet takes the key it saw: a saved pin is never replaced here.
  return ssh && !ssh.hostKeyFingerprint && observed ? withPin(config, observed) : config
}
