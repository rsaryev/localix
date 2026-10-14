import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sshTunnelConfigSchema, type DbConnectionConfig, type SshTunnelConfig } from './contracts'
import type { DbDriver } from './drivers/port'
import { DbError } from './errors'
import { createDatabaseService } from './service'
import {
  createHostKeyCheck,
  hostKeyFingerprint,
  pinObservedHostKey,
  reconcileHostKeyPin,
} from './ssh-host-key'
import type { TunnelHandle } from './ssh-tunnel'
import { createConnectionStore } from './store'

// SHA256("abc") is a published test vector, so this pins the OpenSSH format independently of
// the implementation: unpadded base64 behind `SHA256:`.
const ABC = 'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0'
const OTHER = hostKeyFingerprint(Buffer.from('another key'))

const tunneled = (ssh: Partial<SshTunnelConfig> = {}): DbConnectionConfig => ({
  dialect: 'postgres',
  url: 'postgres://u:p@db.internal:5432/app',
  ssh: { host: 'bastion.example', user: 'tunnel', password: 'pw', ...ssh },
})
const pinOf = (config: DbConnectionConfig) =>
  'ssh' in config ? config.ssh?.hostKeyFingerprint : undefined

describe('host key fingerprint and check', () => {
  it('formats the key as OpenSSH does, and the schema accepts exactly that form', () => {
    expect(hostKeyFingerprint(Buffer.from('abc'))).toBe(ABC)
    const base = { host: 'h', user: 'u', password: 'p' }
    expect(sshTunnelConfigSchema.safeParse({ ...base, hostKeyFingerprint: ABC }).success).toBe(true)
    expect(sshTunnelConfigSchema.safeParse({ ...base, hostKeyFingerprint: 'MD5:aa' }).success).toBe(
      false,
    )
  })

  it('unpinned: accepts any key and records what it saw (first use)', () => {
    const check = createHostKeyCheck('bastion.example', undefined)
    expect(check.verify(Buffer.from('abc'))).toBe(true)
    expect(check.observed()).toBe(ABC)
    expect(check.mismatch()).toBeUndefined()
  })

  it('pinned: accepts the pinned key, refuses another with expected vs got and the way back', () => {
    expect(createHostKeyCheck('bastion.example', ABC).verify(Buffer.from('abc'))).toBe(true)
    const check = createHostKeyCheck('bastion.example', ABC)
    expect(check.verify(Buffer.from('another key'))).toBe(false)
    const error = check.mismatch()!
    expect(error).toBeInstanceOf(DbError)
    expect(error.code).toBe('ssh_failed')
    expect(error.message).toContain(`expected ${ABC}, got ${OTHER}`)
    expect(error.message).toContain('Forget host key')
  })
})

describe('which pin a connect uses', () => {
  const saved = tunneled({ hostKeyFingerprint: ABC })

  it('a fresh connect folding onto the saved target inherits its pin', () => {
    expect(pinOf(reconcileHostKeyPin(saved, tunneled(), { inherit: true }))).toBe(ABC)
  })

  it('an edit without the pin is "Forget host key"; an edit that keeps it keeps it', () => {
    expect(pinOf(reconcileHostKeyPin(saved, tunneled(), { inherit: false }))).toBeUndefined()
    expect(pinOf(reconcileHostKeyPin(saved, saved, { inherit: false }))).toBe(ABC)
  })

  it('moving the bastion (host or port) drops the pin, even one the form carried', () => {
    for (const moved of [{ host: 'other.example' }, { port: 2222 }]) {
      const next = tunneled({ ...moved, hostKeyFingerprint: ABC })
      expect(pinOf(reconcileHostKeyPin(saved, next, { inherit: true }))).toBeUndefined()
    }
    // The default port spelled out is the same bastion.
    expect(pinOf(reconcileHostKeyPin(saved, tunneled({ port: 22 }), { inherit: true }))).toBe(ABC)
  })

  it('after a connect, only an unpinned config takes the observed key', () => {
    expect(pinOf(pinObservedHostKey(tunneled(), OTHER))).toBe(OTHER)
    expect(pinOf(pinObservedHostKey(saved, OTHER))).toBe(ABC)
  })
})

describe('the service pins on first use and verifies after', () => {
  let dir: string
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  const driver = (): DbDriver =>
    ({
      getFlags: () => ({ dialect: 'postgres', kind: 'sql', supportsCancel: true }),
      query: async () => ({ columns: [{ name: 'n' }], rows: [[1]], durationMs: 0 }),
      close: async () => {},
    }) as unknown as DbDriver

  /** A bastion whose key the test controls; it refuses a pin that does not match, like ssh2. */
  async function harness() {
    dir = await mkdtemp(path.join(tmpdir(), 'localix-hostkey-'))
    const bastion = { key: Buffer.from('abc'), seenPins: [] as Array<string | undefined> }
    const service = createDatabaseService({
      store: createConnectionStore({ dir }),
      createDriver: driver,
      openTunnel: async (ssh): Promise<TunnelHandle> => {
        bastion.seenPins.push(ssh.hostKeyFingerprint)
        const check = createHostKeyCheck(ssh.host, ssh.hostKeyFingerprint)
        if (!check.verify(bastion.key)) throw check.mismatch()
        return { localPort: 61000, hostKeyFingerprint: check.observed(), close: async () => {} }
      },
    })
    return { service, bastion }
  }

  it('first connect pins the key; reconnect verifies it; a changed key is refused', async () => {
    const { service, bastion } = await harness()
    const conn = await service.connect('u', { config: tunneled() })
    expect(pinOf((await service.getConfig('u', conn.id))!.config)).toBe(ABC)

    await service.disconnect('u', conn.id)
    await service.reconnect('u', conn.id)
    expect(bastion.seenPins.at(-1)).toBe(ABC)

    await service.disconnect('u', conn.id)
    bastion.key = Buffer.from('another key')
    const refused = await service.reconnect('u', conn.id).catch((err: unknown) => err)
    expect((refused as DbError).message).toContain(`expected ${ABC}, got ${OTHER}`)
    // A refused key is never written over the pin.
    expect(pinOf((await service.getConfig('u', conn.id))!.config)).toBe(ABC)
  })

  it('a fresh connect form to the same target still verifies against the saved pin', async () => {
    const { service, bastion } = await harness()
    await service.connect('u', { config: tunneled() })
    bastion.key = Buffer.from('another key')
    await expect(service.connect('u', { config: tunneled() })).rejects.toThrow('changed')
  })

  it('"Forget host key" (an edit without the pin) re-trusts the key the bastion now has', async () => {
    const { service, bastion } = await harness()
    const conn = await service.connect('u', { config: tunneled() })
    bastion.key = Buffer.from('another key')
    await service.updateConfig('u', conn.id, { config: tunneled() })
    expect(pinOf((await service.getConfig('u', conn.id))!.config)).toBe(OTHER)
  })

  it('moving the bastion clears the old pin and pins the new machine', async () => {
    const { service, bastion } = await harness()
    const conn = await service.connect('u', { config: tunneled() })
    bastion.key = Buffer.from('another key')
    await service.updateConfig('u', conn.id, {
      config: tunneled({ host: 'new-bastion.example', hostKeyFingerprint: ABC }),
    })
    expect(bastion.seenPins.at(-1)).toBeUndefined()
    expect(pinOf((await service.getConfig('u', conn.id))!.config)).toBe(OTHER)
  })

  it('Test connection reports the key a save would pin, and pins nothing', async () => {
    const { service } = await harness()
    expect(await service.testConnection('u', tunneled())).toEqual({ hostKeyFingerprint: ABC })
    expect(await service.list('u')).toEqual([])
  })
})
