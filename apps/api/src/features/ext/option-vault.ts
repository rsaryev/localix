/**
 * Where an extension's `sensitive` option values live: the vault, not `capability_source.config`.
 * The row keeps a handle, `secret:<prefix><owner>.<scope>.<key>`, which says the option is set
 * without saying what it is. Plugins and mini apps each have their own prefix
 * (`plugin-option.`, `mini-app-option.`) and so their own items: one never reads the other's.
 *
 * Every catalog is built several times per turn, so reads are cached per item version.
 */
import { createHash } from 'node:crypto'

/** The vault's own handle spelling (`secrets/contracts.ts` `SECRET_PREFIX`), kept as a literal. */
const SECRET_PREFIX = 'secret:'

/** The vault, narrowed to what extension options need. Audit and shield are the adapter's job. */
export interface OptionVaultPort {
  /** Store or replace one value under `key`, on behalf of the extension `owner`. */
  store(userId: string, key: string, value: string, owner: string): Promise<void>
  /** The current value, or null when the vault no longer holds it. */
  resolve(userId: string, key: string, owner: string): Promise<string | null>
  /** The current version of every key starting with `prefix`. Metadata only, never a value. */
  versions(userId: string, prefix: string): Promise<Map<string, number>>
  remove(userId: string, key: string): Promise<void>
}

type Scalar = string | number | boolean

/** Where an unreadable item is reported. Takes no value, only the key and the vault's reason. */
export type OptionVaultWarn = (entry: Record<string, unknown>) => void

let vault: OptionVaultPort | undefined
let warn: OptionVaultWarn = () => {}
/**
 * Values already read, by version. Every vault read writes an audit entry and a catalog is
 * built several times per turn, so an unchanged item is read once per process, as monitors do
 * (`monitors/credentials.ts`). The version check keeps a rotation or deletion made in the vault
 * itself from being masked by the cache. A read that failed is remembered too (`value: null`), so
 * an undecryptable item is not retried, audited and reported by every build until it changes.
 */
const cache = new Map<string, { version: number; value: string | null }>()

export function observeOptionVault(
  next: OptionVaultPort | undefined,
  onUnreadable?: OptionVaultWarn,
): void {
  vault = next
  warn = onUnreadable ?? (() => {})
  cache.clear()
}

/**
 * One key segment, one-to-one: a name the vault's key alphabet already spells (minus the `.`
 * that separates segments) is kept, anything else is `_x` and its UTF-8 bytes in hex, so `a.b`
 * and `a-b` never share an item. A plain name starting `_x` is encoded too, keeping the two forms
 * apart.
 */
const part = (text: string) =>
  /^[A-Za-z0-9_-]+$/.test(text) && !text.startsWith('_x')
    ? text
    : `_x${Buffer.from(text).toString('hex')}`
const cacheKey = (userId: string, key: string) => `${userId}\0${key}`
/** The vault's key length (`secrets/limits.ts` `SECRET_KEY_MAX_LENGTH`). */
const KEY_MAX = 128
const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32)
/** One kind's options in the vault, every key under `prefix`. */
export function optionVault(prefix: string) {
  const KEY_PREFIX = prefix
  /** Every item of one plugin starts here, so its last uninstall can find them all. */
  const ownerPrefix = (owner: string) => {
    const name = part(owner)
    return `${KEY_PREFIX}${name.length <= 48 ? name : `_h${digest(owner)}`}.`
  }

  /**
   * The vault key of one option: per plugin, per row scope ('' = the user's), per option. A key
   * past the vault's length keeps its plugin prefix and digests the rest, rather than cutting it
   * short and letting two options share an item.
   */
  function optionKey(owner: string, scope: string, option: string): string {
    const prefix = ownerPrefix(owner)
    const full = `${prefix}${part(scope || 'user')}.${part(option)}`
    return full.length <= KEY_MAX ? full : `${prefix}_h${digest(`${scope}\0${option}`)}`
  }

  /** Whether sensitive options go to the vault in this process (unset in tests and scripts). */
  const sealsSecrets = (): boolean => vault !== undefined

  /** Whether a stored value is a plugin-option vault handle rather than the value itself. */
  const isSecretHandle = (value: unknown): boolean => handleKey(value) !== null

  /** The vault key a stored value hands off to, or null for an ordinary value. */
  function handleKey(value: unknown): string | null {
    if (typeof value !== 'string' || !value.startsWith(SECRET_PREFIX)) return null
    const key = value.slice(SECRET_PREFIX.length)
    return key.startsWith(KEY_PREFIX) ? key : null
  }

  /**
   * Whether `key` is the one item this row's `option` may read: the key sealing gives that plugin,
   * scope and option. Sealing writes it only for an option declared sensitive, so a handle pointing
   * anywhere else (another plugin's item, or a sibling option's) is never resolved: a non-secret
   * field holding `secret:plugin-option.<other>…` would hand that plugin's token back in plain text.
   */
  const ownsKey = (row: { name: string; projectId: string }, option: string, key: string) =>
    key === optionKey(row.name, row.projectId, option)

  /**
   * The patch to write into the row: each sensitive option's value moved to the vault and replaced
   * by its handle. A sensitive value an older build stored in plain text (`existing`) is moved too,
   * so a save is also the migration.
   */
  async function sealSecretOptions(input: {
    userId: string
    owner: string
    scope: string
    declared: Record<string, { secret?: boolean }>
    patch: Record<string, Scalar>
    existing?: Record<string, unknown>
  }): Promise<Record<string, Scalar>> {
    const own = (option: string) => optionKey(input.owner, input.scope, option)
    // A handle is ours to write, never the caller's: one naming any item but this option's own
    // is dropped, so the save cannot point an option at a vault item it does not own.
    const out: Record<string, Scalar> = Object.fromEntries(
      Object.entries(input.patch).filter(([option, value]) => {
        const key = handleKey(value)
        return key === null || key === own(option)
      }),
    )
    if (!vault) return out
    const legacy = Object.entries(input.existing ?? {}).filter(
      ([key, value]) =>
        !(key in input.patch) &&
        input.declared[key]?.secret &&
        (typeof value === 'number' || (typeof value === 'string' && value !== '')) &&
        handleKey(value) === null,
    )
    for (const [option, value] of [...Object.entries(out), ...legacy]) {
      if (!input.declared[option]?.secret || handleKey(value) !== null) continue
      const key = own(option)
      await vault.store(input.userId, key, String(value), input.owner)
      cache.delete(cacheKey(input.userId, key))
      out[option] = `${SECRET_PREFIX}${key}`
    }
    return out
  }

  /**
   * Rows with each handle replaced by the vault's value. An option whose item the vault no longer
   * holds, cannot read (a replaced key file, an unavailable backend) or that names an item it does
   * not own ({@link ownsKey}) is dropped, so it reads as unset rather than as its handle, and one
   * unreadable item never fails the catalog every run, hook and server is built from.
   */
  async function hydrateSecretOptions<
    T extends { name: string; projectId: string; config: Record<string, unknown> },
  >(userId: string, rows: T[]): Promise<T[]> {
    const port = vault
    if (!port || !rows.some((row) => Object.values(row.config).some((v) => handleKey(v)))) {
      return rows
    }
    const versions = await port.versions(userId, KEY_PREFIX).catch((error: unknown) => {
      warn({ event: 'extension_option.vault_unreadable', meta: { error: messageOf(error) } })
      return new Map<string, number>()
    })
    return Promise.all(
      rows.map(async (row) => {
        if (!Object.values(row.config).some((v) => handleKey(v))) return row
        const config: Record<string, unknown> = { ...row.config }
        for (const [option, stored] of Object.entries(row.config)) {
          const key = handleKey(stored)
          if (!key) continue
          const value = ownsKey(row, option, key)
            ? await readOption(port, userId, key, row.name, versions.get(key))
            : null
          if (value === null) delete config[option]
          else config[option] = value
        }
        return { ...row, config }
      }),
    )
  }

  /** One item's value through the cache, or null when it is gone or cannot be read. */
  async function readOption(
    port: OptionVaultPort,
    userId: string,
    key: string,
    owner: string,
    version: number | undefined,
  ): Promise<string | null> {
    if (version === undefined) return null
    const hit = cache.get(cacheKey(userId, key))
    if (hit?.version === version) return hit.value
    let value: string | null
    try {
      value = await port.resolve(userId, key, owner)
    } catch (error) {
      warn({
        event: 'extension_option.option_unreadable',
        owner,
        key,
        meta: { error: messageOf(error) },
      })
      value = null
    }
    cache.set(cacheKey(userId, key), { version, value })
    return value
  }

  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

  /** One row, hydrated (see {@link hydrateSecretOptions}). */
  async function hydrateSecretOption<
    T extends { name: string; projectId: string; config: Record<string, unknown> },
  >(userId: string, row: T | null | undefined): Promise<T | undefined> {
    return row ? (await hydrateSecretOptions(userId, [row]))[0] : undefined
  }

  /** Delete every vault item a plugin's options hold, in every scope (its last uninstall). */
  async function forgetSecretOptions(userId: string, owner: string): Promise<void> {
    if (!vault) return
    for (const key of (await vault.versions(userId, ownerPrefix(owner))).keys()) {
      await vault.remove(userId, key)
      cache.delete(cacheKey(userId, key))
    }
  }

  return {
    optionKey,
    sealsSecrets,
    isSecretHandle,
    sealSecretOptions,
    hydrateSecretOptions,
    hydrateSecretOption,
    forgetSecretOptions,
  }
}

export type OptionVault = ReturnType<typeof optionVault>
