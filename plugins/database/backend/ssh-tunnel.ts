/**
 * SSH-tunnel manager for network database connections.
 *
 * When a connection carries an `ssh` block, the service opens an SSH connection to the
 * bastion, forwards a local ephemeral 127.0.0.1 port to the DB target (parsed from the
 * connection URL), and points the driver at that local port. The handle is stored on the
 * live entry so disconnect/remove/health-drop close the tunnel alongside the driver.
 *
 * Bun note: `net.Socket.pipe(ssh2Stream)` does NOT flow reliably under Bun, and the DB
 * client writes its startup packet before the async `forwardOut` callback resolves — so
 * this manager (a) relays bytes manually with `on('data')`/`write` instead of `pipe`, and
 * (b) attaches the incoming socket's data listener SYNCHRONOUSLY and buffers early bytes
 * until the forwarded channel is ready. Proven end-to-end against a real sshd + postgres.
 */
import net from 'node:net'
import { Client, type ClientChannel } from 'ssh2'
import { isFileConnectionConfig, type DbConnectionConfig, type SshTunnelConfig } from './contracts'
import { DbError } from './errors'
import { getDatabaseDriverManifest } from '../shared/driver-catalog'
import { createHostKeyCheck } from './ssh-host-key'

/** A live SSH tunnel: a local forwarded port + a close that tears down the forward + SSH. */
export interface TunnelHandle {
  /** The local 127.0.0.1 port the driver should connect to. */
  localPort: number
  /** The bastion's host key as presented on this connect — what first use pins. */
  hostKeyFingerprint?: string
  close(): Promise<void>
}

/** The DB endpoint (as seen from the bastion) a tunnel forwards to. */
export interface TunnelTarget {
  host: string
  port: number
}

/**
 * Parse the DB endpoint a network connection points at (host + port from the bastion's
 * perspective) — the tunnel forwards a local port to this target. Pure. A connection is
 * described EITHER by a `url` OR by discrete `host`/`port` fields; both are handled.
 * Throws a typed `ssh_failed` when there is no host or (mongodb+srv) can't be tunneled.
 */
export function tunnelTargetFor(config: DbConnectionConfig): TunnelTarget {
  if (isFileConnectionConfig(config)) {
    const label = getDatabaseDriverManifest(config.dialect).label
    throw new DbError('ssh_failed', `${label} connections cannot use an SSH tunnel`)
  }
  const manifest = getDatabaseDriverManifest(config.dialect)
  // URL mode: parse host/port out of the connection URL.
  if (config.url) {
    if (/^mongodb\+srv:/i.test(config.url.trim())) {
      throw new DbError(
        'ssh_failed',
        'SSH tunneling is not supported for mongodb+srv:// URLs (use a direct mongodb:// host:port)',
      )
    }
    let url: URL
    try {
      url = new URL(config.url.trim())
    } catch {
      throw new DbError(
        'ssh_failed',
        `Could not parse the connection URL to find the tunnel target`,
      )
    }
    const host = url.hostname
    if (!host) throw new DbError('ssh_failed', 'The connection URL has no host to tunnel to')
    const secureScheme =
      url.protocol === 'https:' || url.protocol === 'rediss:' || url.protocol === 'clickhouses:'
    // A separate TLS option is authoritative beside a URL. This matters when the URL omits
    // its port: the SSH forward must target the same plain/secure endpoint that the driver
    // will use after its URL and TLS options are merged.
    const secure = config.ssl === undefined ? secureScheme : config.ssl !== false
    const defaultPort = secure
      ? (manifest.defaultTlsPort ?? manifest.defaultPort)
      : manifest.defaultPort
    const port = url.port ? Number(url.port) : defaultPort
    if (!port)
      throw new DbError(
        'ssh_failed',
        `Could not determine a port for the ${config.dialect} tunnel target`,
      )
    return { host, port }
  }
  // Fields mode: discrete host/port (port falls back to the per-dialect default).
  if (config.host) {
    const secure = config.ssl !== undefined && config.ssl !== false
    const defaultPort = secure
      ? (manifest.defaultTlsPort ?? manifest.defaultPort)
      : manifest.defaultPort
    const port = config.port ?? defaultPort
    if (!port)
      throw new DbError(
        'ssh_failed',
        `Could not determine a port for the ${config.dialect} tunnel target`,
      )
    return { host: config.host, port }
  }
  throw new DbError('ssh_failed', 'The connection has no host to tunnel to')
}

/**
 * Return a copy of the config that points the driver at `localHost:localPort` (the tunnel's
 * local end). In URL mode the URL's host/port are rewritten (credentials / path / query
 * preserved); in fields mode the discrete `host`/`port` are replaced. Pure. `ssh` is dropped
 * from the copy (the driver has no business seeing it). Only the persisted config keeps `ssh`.
 */
export function rewriteConfigForTunnel(
  config: DbConnectionConfig,
  localHost: string,
  localPort: number,
): DbConnectionConfig {
  if (isFileConnectionConfig(config)) return config
  const { ssh: _ssh, ...rest } = config
  if (config.url) {
    const url = new URL(config.url.trim())
    url.hostname = localHost
    url.port = String(localPort)
    return { ...rest, url: url.toString() }
  }
  // Fields mode: repoint host/port at the local end (user/password/database/ssl kept).
  return { ...rest, host: localHost, port: localPort }
}

/** Translate an ssh2 connection error into a typed `ssh_failed` DbError (auth vs connect). */
export function mapSshError(err: unknown): DbError {
  if (err instanceof DbError) return err
  const raw = err instanceof Error ? err.message : String(err)
  const low = raw.toLowerCase()
  if (
    low.includes('all configured authentication methods failed') ||
    low.includes('authentication')
  ) {
    return new DbError(
      'ssh_failed',
      `SSH authentication failed — check the SSH user, password, or key. (${raw})`,
    )
  }
  return new DbError(
    'ssh_failed',
    `Could not open the SSH tunnel — check the SSH host and port. (${raw})`,
  )
}

/**
 * Open an SSH tunnel: connect to the bastion, listen on a local ephemeral 127.0.0.1 port,
 * and forward each accepted local connection to `target` over the SSH channel. Rejects
 * with a typed `ssh_failed` DbError on connect/auth failure. Resolves once the local
 * listener is up. The caller stores the handle and closes it with the driver.
 */
export function openTunnel(ssh: SshTunnelConfig, target: TunnelTarget): Promise<TunnelHandle> {
  return new Promise<TunnelHandle>((resolve, reject) => {
    const conn = new Client()
    const hostKey = createHostKeyCheck(ssh.host, ssh.hostKeyFingerprint)
    let settled = false
    // Hoisted so `fail` can release the local listener too: if the SSH connection errors
    // AFTER `ready` (during the listen window), closing `conn` alone would orphan the bound
    // 127.0.0.1 server. Crumple zone — every pre-resolve failure path releases BOTH handles.
    let server: net.Server | null = null
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      if (server) {
        try {
          server.close()
        } catch {
          /* ignore */
        }
      }
      try {
        conn.end()
      } catch {
        /* ignore */
      }
      // A refused host key surfaces from ssh2 as a bare "Host denied (verification failed)";
      // the check holds the sentence that says which key was expected and how to re-trust.
      reject(hostKey.mismatch() ?? mapSshError(err))
    }

    conn.on('error', fail)
    conn.on('ready', () => {
      const srv = net.createServer((sock) => {
        // Attach the data listener SYNCHRONOUSLY and buffer bytes that arrive before the
        // async forwardOut channel is ready — the DB client writes its startup packet
        // immediately on connect and those bytes would otherwise be lost under Bun.
        const early: Buffer[] = []
        let channel: ClientChannel | null = null
        sock.on('data', (d: Buffer) => {
          if (channel) channel.write(d)
          else early.push(d)
        })
        sock.on('error', () => {})
        conn.forwardOut(
          sock.remoteAddress ?? '127.0.0.1',
          sock.remotePort ?? 0,
          target.host,
          target.port,
          (err, stream) => {
            if (err || !stream) {
              sock.destroy()
              return
            }
            channel = stream
            for (const b of early) stream.write(b)
            early.length = 0
            stream.on('data', (d: Buffer) => sock.write(d))
            stream.on('error', () => {})
            stream.on('close', () => sock.destroy())
            sock.on('close', () => stream.end())
          },
        )
      })
      server = srv
      srv.on('error', fail)
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address()
        const localPort = typeof addr === 'object' && addr ? addr.port : 0
        if (!localPort) {
          fail(new Error('Failed to allocate a local tunnel port'))
          return
        }
        settled = true
        const observed = hostKey.observed()
        resolve({
          localPort,
          ...(observed ? { hostKeyFingerprint: observed } : {}),
          close: () =>
            new Promise<void>((res) => {
              srv.close(() => {
                try {
                  conn.end()
                } catch {
                  /* ignore */
                }
                res()
              })
            }),
        })
      })
    })

    const auth: Record<string, unknown> = {
      host: ssh.host,
      port: ssh.port ?? 22,
      username: ssh.user,
      // Fail fast rather than hanging a connect on an unreachable bastion.
      readyTimeout: 20_000,
      // Without a verifier ssh2 accepts any server key (see `ssh-host-key.ts`).
      hostVerifier: (key: Buffer) => hostKey.verify(key),
    }
    if (ssh.privateKey) {
      auth.privateKey = ssh.privateKey
      if (ssh.passphrase) auth.passphrase = ssh.passphrase
    }
    if (ssh.password) auth.password = ssh.password
    try {
      conn.connect(auth)
    } catch (err) {
      fail(err)
    }
  })
}
