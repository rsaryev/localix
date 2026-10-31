import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

import { localixHome } from '../../../lib/env'
import { createKeyedSerializer } from '../../../lib/keyed-serializer'
import { atomicWriteFile, safeFileKey } from '@localixai/mini-app-sdk/backend'
import { createAesCipher, type SecretCipher } from '../../secrets/cipher'
import { loadOrCreateMasterKey } from '../../secrets/master-key'

/**
 * Encrypted-at-rest store of MCP OAuth material, per `(userId, serverId)`. Holds
 * the three things the SDK's `OAuthClientProvider` persists across the browser
 * round-trip: the issued `tokens` (access + refresh), the dynamically-registered
 * `clientInfo`, and the in-flight PKCE `codeVerifier`. The `serverUrl` is kept in
 * cleartext so we can detect a URL change (which invalidates stored credentials)
 * and show connection status without decrypting.
 *
 * Backed by `~/.localix/mcp-oauth/<userId>.json`; the sensitive per-server blob is
 * AES-256-GCM encrypted with a master key beside it — literally the secrets vault's
 * key loader now, not just "the same scheme" (see ../secrets/master-key).
 *
 * One file per user, rewritten in full on every change and swapped atomically. It used
 * to claim it was "rewritten atomically-enough for a single-user IDE", which was not a
 * weaker guarantee but a false one: writeFile truncates and then writes no matter how
 * many users there are, so a crash mid-write left a half-file — and since one server's
 * token refresh rewrites the whole map, that cost every OTHER server's tokens too.
 */
export interface McpOAuthEntry {
  serverUrl: string
  tokens?: OAuthTokens
  clientInfo?: OAuthClientInformationFull
  codeVerifier?: string
}

export interface McpOAuthStore {
  get(userId: string, serverId: string): Promise<McpOAuthEntry | undefined>
  update(
    userId: string,
    serverId: string,
    patch: Partial<McpOAuthEntry> & { serverUrl: string },
  ): Promise<void>
  clear(userId: string, serverId: string): Promise<void>
  /** Cheap status: does this server have tokens stored? (no decrypt of the payload). */
  hasTokens(userId: string, serverId: string): Promise<boolean>
}

interface StoredRow {
  serverUrl: string
  /** AES blob of the JSON `{ tokens?, clientInfo?, codeVerifier? }`. */
  secret?: string
}

/**
 * Default store dir, rooted at the ONE `~/.localix` home (`lib/env.ts`) — like the
 * secrets vault it mirrors, and for the same reason: OAuth tokens are machine-level
 * user state, and a cwd-relative fallback would drop them into whatever directory the
 * app happened to start in.
 */
export function defaultMcpOAuthDir(): string {
  return path.join(localixHome(), 'mcp-oauth')
}

export function createMcpOAuthStore(
  opts: { dir?: string; cipher?: SecretCipher } = {},
): McpOAuthStore {
  const dir = opts.dir ?? defaultMcpOAuthDir()
  /**
   * Every mutation here is read-whole-map → change one row → write-whole-map, with awaits
   * in between. Two of them interleaved is a LOST UPDATE: both read the same map, both
   * write it back, and the first one's row silently reverts to its pre-refresh value. No
   * crash and no error — the user just finds a server unauthenticated again and re-runs
   * the browser flow for a token that HAD been refreshed.
   *
   * That interleaving is the normal path, not an exotic race: `client-manager.ts` acquires
   * every enabled server through one `Promise.all`, and each OAuth server's connect can
   * call saveTokens / saveClientInformation / saveCodeVerifier — all of which land here,
   * on the same per-user file.
   *
   * Keyed by USER because that is the write granularity (one file per user), not by
   * server: two DIFFERENT servers are exactly the pair that clobbers. The app's other
   * Other credential stores serialize for the same reason, and `user-entity-store`
   * states it as a design rule — this store was the outlier.
   */
  const serialize = createKeyedSerializer()
  let cipherP: Promise<SecretCipher> | undefined
  const cipher = async (): Promise<SecretCipher> => {
    if (opts.cipher) return opts.cipher
    cipherP ??= loadOrCreateMasterKey(dir).then(createAesCipher)
    return cipherP
  }

  const fileFor = (userId: string) => path.join(dir, `${safeFileKey(userId)}.json`)

  const readAll = async (userId: string): Promise<Record<string, StoredRow>> => {
    try {
      return JSON.parse(await readFile(fileFor(userId), 'utf8')) as Record<string, StoredRow>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
  }

  /**
   * Rewrites the WHOLE map every time, so it must be atomic: one server's token refresh
   * carries every other server's tokens through this write, and a torn one takes them
   * all. temp+rename means a reader (or a crash) sees the old file or the new one.
   * 0600 rides the temp — the target never exists world-readable.
   */
  const writeAll = async (userId: string, rows: Record<string, StoredRow>): Promise<void> => {
    await mkdir(dir, { recursive: true })
    await atomicWriteFile(fileFor(userId), JSON.stringify(rows, null, 2), { mode: 0o600 })
  }

  return {
    async get(userId, serverId) {
      const rows = await readAll(userId)
      const row = rows[serverId]
      if (!row) return undefined
      let payload: {
        tokens?: OAuthTokens
        clientInfo?: OAuthClientInformationFull
        codeVerifier?: string
      } = {}
      if (row.secret) {
        try {
          payload = JSON.parse((await cipher()).decrypt(row.secret))
        } catch {
          payload = {}
        }
      }
      return { serverUrl: row.serverUrl, ...payload }
    },

    update(userId, serverId, patch) {
      return serialize(userId, async () => {
        const rows = await readAll(userId)
        const existing = rows[serverId]
        let current: McpOAuthEntry = { serverUrl: patch.serverUrl }
        if (existing?.secret) {
          try {
            current = {
              serverUrl: existing.serverUrl,
              ...JSON.parse((await cipher()).decrypt(existing.secret)),
            }
          } catch {
            /* corrupt → start clean */
          }
        }
        // A URL change invalidates the stored credentials (they were issued for the
        // old resource) — reset them so the SDK re-registers + re-auths. A field is
        // taken from the patch when its KEY is present (so an explicit `undefined`
        // CLEARS it — e.g. saveTokens dropping the one-shot code verifier); otherwise
        // the existing value is kept.
        const urlChanged = Boolean(existing && existing.serverUrl !== patch.serverUrl)
        const pick = <K extends 'tokens' | 'clientInfo' | 'codeVerifier'>(
          key: K,
        ): McpOAuthEntry[K] => {
          if (key in patch) return patch[key] as McpOAuthEntry[K]
          return urlChanged ? undefined : current[key]
        }
        const next: McpOAuthEntry = {
          serverUrl: patch.serverUrl,
          tokens: pick('tokens'),
          clientInfo: pick('clientInfo'),
          codeVerifier: pick('codeVerifier'),
        }
        const secret = (await cipher()).encrypt(
          JSON.stringify({
            tokens: next.tokens,
            clientInfo: next.clientInfo,
            codeVerifier: next.codeVerifier,
          }),
        )
        rows[serverId] = { serverUrl: next.serverUrl, secret }
        await writeAll(userId, rows)
      })
    },

    clear(userId, serverId) {
      return serialize(userId, async () => {
        const rows = await readAll(userId)
        if (!(serverId in rows)) return
        delete rows[serverId]
        await writeAll(userId, rows)
      })
    },

    async hasTokens(userId, serverId) {
      const entry = await this.get(userId, serverId)
      return Boolean(entry?.tokens?.access_token)
    },
  }
}
