/** SSH-tunnel slice of the connect-form state (network dialects only). */
import { useMemo, useState } from 'react'
import type { DbDialect, SshTunnelConfig } from '../../dbClient'
import { isSecretToken } from '../../model/connectionSecret'
import { getDatabaseDriverManifest } from '../../../shared/driver-catalog'

export function sshTunnelIssue(input: {
  enabled: boolean
  supported: boolean
  host: string
  port: string
  user: string
  auth: 'password' | 'key'
  password: string
  privateKey: string
}): string | null {
  if (!input.supported || !input.enabled) return null
  if (!input.host.trim()) return 'SSH host is required.'
  if (input.port.trim()) {
    const port = Number(input.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return 'SSH port must be between 1 and 65535.'
    }
  }
  if (!input.user.trim()) return 'SSH user is required.'
  if (input.auth === 'password' && !input.password) return 'SSH password is required.'
  if (input.auth === 'key' && !input.privateKey.trim()) return 'SSH private key is required.'
  return null
}

/**
 * The host-key pin the edited config carries back. The edit form must round-trip it — the
 * server reads a missing pin on an edit as "Forget host key" — but only while the bastion is
 * the one that key belongs to: pointing the form at another host or port drops it, exactly as
 * the server's `reconcileHostKeyPin` would.
 */
export function formHostKeyPin(
  edit: SshTunnelConfig | undefined,
  input: { host: string; port: string; forgotten: boolean },
): string | undefined {
  if (!edit?.hostKeyFingerprint || input.forgotten) return undefined
  const sameHost = input.host.trim().toLowerCase() === edit.host.trim().toLowerCase()
  const port = input.port.trim() ? Number(input.port.trim()) : 22
  return sameHost && port === (edit.port ?? 22) ? edit.hostKeyFingerprint : undefined
}

export function useSshTunnel(dialect: DbDialect, editSsh: SshTunnelConfig | undefined) {
  const [sshEnabled, setSshEnabled] = useState(() => !!editSsh)
  const [sshHost, setSshHost] = useState(() => editSsh?.host ?? '')
  const [sshPort, setSshPort] = useState(() => (editSsh?.port ? String(editSsh.port) : ''))
  const [sshUser, setSshUser] = useState(() => editSsh?.user ?? '')
  const [sshAuth, setSshAuth] = useState<'password' | 'key'>(() =>
    editSsh?.privateKey ? 'key' : 'password',
  )
  const [sshPassword, setSshPassword] = useState(() => editSsh?.password ?? '')
  const [sshPrivateKey, setSshPrivateKey] = useState(() => editSsh?.privateKey ?? '')
  const [sshPassphrase, setSshPassphrase] = useState(() => editSsh?.passphrase ?? '')
  const [storeSshSecret, setStoreSshSecret] = useState(true)
  const [hostKeyForgotten, setHostKeyForgotten] = useState(false)
  const hostKeyPin = formHostKeyPin(editSsh, {
    host: sshHost,
    port: sshPort,
    forgotten: hostKeyForgotten,
  })
  const supported = getDatabaseDriverManifest(dialect).capabilities.sshTunnel
  const issue = sshTunnelIssue({
    enabled: sshEnabled,
    supported,
    host: sshHost,
    port: sshPort,
    user: sshUser,
    auth: sshAuth,
    password: sshPassword,
    privateKey: sshPrivateKey,
  })

  // Assemble the SSH block only after every selected-auth field validates. The parent treats
  // `issue` as a hard config error, so an incomplete enabled tunnel can never degrade into a
  // direct database connection.
  const ssh = useMemo<SshTunnelConfig | undefined>(() => {
    if (!supported || !sshEnabled || issue) return undefined
    const host = sshHost.trim()
    const user = sshUser.trim()
    const portNum = sshPort.trim() ? Number(sshPort.trim()) : undefined
    const out: SshTunnelConfig = { host, user }
    if (portNum !== undefined) out.port = portNum
    if (sshAuth === 'password') {
      if (sshPassword) out.password = sshPassword
    } else {
      if (sshPrivateKey.trim()) out.privateKey = sshPrivateKey
      if (sshPassphrase) out.passphrase = sshPassphrase
    }
    if (hostKeyPin) out.hostKeyFingerprint = hostKeyPin
    return out
  }, [
    hostKeyPin,
    supported,
    sshEnabled,
    issue,
    sshHost,
    sshPort,
    sshUser,
    sshAuth,
    sshPassword,
    sshPrivateKey,
    sshPassphrase,
  ])

  // Offer to vault the SSH credential when a raw (non-token) one is present — like the DB password.
  const canStoreSshSecret =
    sshEnabled &&
    ((sshAuth === 'password' && !!sshPassword && !isSecretToken(sshPassword)) ||
      (sshAuth === 'key' &&
        ((!!sshPrivateKey && !isSecretToken(sshPrivateKey)) ||
          (!!sshPassphrase && !isSecretToken(sshPassphrase)))))

  return {
    sshEnabled,
    setSshEnabled,
    sshHost,
    setSshHost,
    sshPort,
    setSshPort,
    sshUser,
    setSshUser,
    sshAuth,
    setSshAuth,
    sshPassword,
    setSshPassword,
    sshPrivateKey,
    setSshPrivateKey,
    sshPassphrase,
    setSshPassphrase,
    storeSshSecret,
    setStoreSshSecret,
    /** The pinned bastion key this config will verify against, if any. */
    hostKeyPin,
    /** A saved pin existed and the user forgot it — the next connect trusts what it meets. */
    hostKeyForgotten: hostKeyForgotten && !!editSsh?.hostKeyFingerprint,
    forgetHostKey: () => setHostKeyForgotten(true),
    ssh,
    issue,
    canStoreSshSecret,
  }
}
