import { optionVault } from '../ext/option-vault'
import { isRecord } from '../../lib/record'
import type { McpServerRecord } from './repository'

/**
 * WHERE AN MCP SERVER'S SECRETS LIVE: the vault, never the row (`ext/option-vault.ts`, as plugin
 * and mini app options do). A server's headers (an `Authorization` token), environment (an API
 * key) and pre-registered OAuth client secret are sealed under `mcp-option.…`; the row keeps a
 * handle that says the value exists without saying what it is.
 *
 * Each of the three is one vault item per server and scope: a map is stored whole as JSON, which
 * is also how the Settings tab replaces it (a secret map is never sent back to the client). A
 * server of the same name in the person's scope and in a project's therefore never share one.
 * Unset (tests, scripts) nothing is sealed and the row holds the values as it always did.
 */
const vault = optionVault('mcp-option.')

/** The sealed fields, flat as the vault stores them; `oauth.clientSecret` is `oauthClientSecret`. */
const SECRET_KEYS = ['env', 'headers', 'oauthClientSecret'] as const
type SecretKey = (typeof SECRET_KEYS)[number]
const DECLARED = Object.fromEntries(SECRET_KEYS.map((key) => [key, { secret: true }]))

interface At {
  name: string
  projectId: string
}

/** One vault owner per server and scope, so removing one never reaches the other. */
const ownerOf = (at: At) => `${at.projectId || 'user'}:${at.name}`

const filled = (value: unknown): boolean =>
  typeof value === 'string' ? value !== '' : isRecord(value) && Object.keys(value).length > 0

/** The secrets of a config as flat fields, empty ones left out. */
function secretsOf(config: Record<string, unknown>): Partial<Record<SecretKey, unknown>> {
  const oauth = isRecord(config.oauth) ? config.oauth : {}
  const flat = { env: config.env, headers: config.headers, oauthClientSecret: oauth.clientSecret }
  return Object.fromEntries(Object.entries(flat).filter(([, value]) => filled(value)))
}

/** The config without its secrets, which are written as handles or put back by the caller. */
function withoutSecrets(config: Record<string, unknown>): Record<string, unknown> {
  const { env: _env, headers: _headers, oauth, ...rest } = config
  if (!isRecord(oauth)) return rest
  const { clientSecret: _secret, ...open } = oauth
  return Object.keys(open).length > 0 ? { ...rest, oauth: open } : rest
}

/** The config to store: each filled secret moved to the vault and replaced by its handle. */
export async function sealMcpConfig(
  userId: string,
  at: At,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!vault.sealsSecrets()) return config
  const secrets = secretsOf(config)
  const patch = Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  )
  const sealed = await vault.sealSecretOptions({
    userId,
    owner: ownerOf(at),
    scope: '',
    declared: DECLARED,
    patch,
  })
  return { ...withoutSecrets(config), ...sealed }
}

/** Which secrets of a stored config hold a value: a handle, or a value stored unsealed. */
export const mcpSecretsSet = (config: Record<string, unknown>): string[] =>
  SECRET_KEYS.filter((key) => filled(config[key]) || key in secretsOf(config))

/** Stored records with their secrets put back, as a connection needs them. */
export async function hydrateMcpRecords(
  userId: string,
  records: readonly McpServerRecord[],
): Promise<McpServerRecord[]> {
  const handles = (record: McpServerRecord) =>
    SECRET_KEYS.filter((key) => vault.isSecretHandle(record.config[key]))
  if (!records.some((record) => handles(record).length > 0)) return [...records]
  const hydrated = await vault.hydrateSecretOptions(
    userId,
    records.map((record) => ({
      name: ownerOf(record),
      projectId: '',
      config: Object.fromEntries(handles(record).map((key) => [key, record.config[key]])),
    })),
  )
  return records.map((record, index) => {
    const out = { ...record.config }
    for (const key of handles(record)) {
      delete out[key]
      const value = hydrated[index]?.config[key]
      if (value === undefined) continue
      if (key === 'oauthClientSecret') {
        out.oauth = { ...(isRecord(out.oauth) ? out.oauth : {}), clientSecret: value }
      } else {
        const map = parseMap(value)
        if (map) out[key] = map
      }
    }
    return { ...record, config: out }
  })
}

/** A map the vault returned as JSON; one stored unsealed is already a map. */
function parseMap(value: unknown): Record<string, string> | undefined {
  if (isRecord(value)) return value as Record<string, string>
  try {
    const parsed: unknown = JSON.parse(String(value))
    return isRecord(parsed) ? (parsed as Record<string, string>) : undefined
  } catch {
    return undefined
  }
}

/** Delete what one server's secrets hold, when the server is removed. */
export async function forgetMcpSecrets(userId: string, at: At): Promise<void> {
  await vault.forgetSecretOptions(userId, ownerOf(at))
}
