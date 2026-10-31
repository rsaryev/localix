/**
 * A PROVIDER'S OWN SETTINGS: what a connection names besides its key — the cloud region, the
 * resource or the project its requests go to (`AWS_REGION`, `AZURE_RESOURCE_NAME`,
 * `GOOGLE_VERTEX_PROJECT`).
 *
 * models.dev lists every variable a provider reads, and an address may name them
 * (`https://${AZURE_RESOURCE_NAME}.openai.azure.com/openai/v1`). A connection is asked only for
 * the ones a request uses — an address names it, or a cloud reads it — and never for a secret,
 * which belongs in the key. They are filled in per request, never from the server's environment,
 * which would quietly lend a connection credentials it was not given.
 */
import { isSecretSettingName } from '@localixai/agent/catalog'

import { LOOPBACK } from './addresses'

export interface ProviderSetting {
  /** The variable models.dev names, which the connection stores it under. */
  name: string
  label: string
  placeholder?: string
  /** A request cannot be made without it. */
  required: boolean
}

const TEMPLATE = /\$\{([A-Z0-9_]+)\}/g
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

/** What a person is asked for, by variable. The clouds read the first five themselves. */
const KNOWN: Readonly<Record<string, Omit<ProviderSetting, 'name'>>> = {
  AWS_REGION: { label: 'AWS region', placeholder: 'us-east-1', required: true },
  AZURE_RESOURCE_NAME: { label: 'Azure resource name', placeholder: 'my-resource', required: true },
  AZURE_COGNITIVE_SERVICES_RESOURCE_NAME: {
    label: 'Azure resource name',
    placeholder: 'my-resource',
    required: true,
  },
  // A service account key names its project, and an express-mode API key needs neither.
  GOOGLE_VERTEX_PROJECT: {
    label: 'Google Cloud project',
    placeholder: 'from the service account key',
    required: false,
  },
  GOOGLE_VERTEX_LOCATION: { label: 'Vertex location', placeholder: 'us-central1', required: false },
  CLOUDFLARE_ACCOUNT_ID: { label: 'Cloudflare account ID', required: true },
  DATABRICKS_HOST: {
    label: 'Databricks workspace host',
    placeholder: 'dbc-1234.cloud.databricks.com',
    required: true,
  },
  INFOMANIAK_PRODUCT_ID: { label: 'Infomaniak product ID', required: true },
  NEON_AI_GATEWAY_BASE_URL: {
    label: 'Neon AI gateway URL',
    placeholder: 'https://…neon.tech/ai',
    required: true,
  },
  SNOWFLAKE_ACCOUNT: {
    label: 'Snowflake account',
    placeholder: 'xy12345.us-east-1',
    required: true,
  },
}

/** The variables a cloud SDK reads from the connection itself, not through an address. */
const CLOUD_READ = new Set([
  'AWS_REGION',
  'AZURE_RESOURCE_NAME',
  'AZURE_COGNITIVE_SERVICES_RESOURCE_NAME',
  'GOOGLE_VERTEX_PROJECT',
  'GOOGLE_VERTEX_LOCATION',
])

/** The variables an address names. */
export function templateNames(address: string): string[] {
  return [...address.matchAll(TEMPLATE)].map((match) => match[1]!)
}

/**
 * The settings among a provider's variables: every one that is not a secret and that a request
 * uses — named by one of the provider's `addresses`, or read by its cloud. A variable nothing
 * reads (`PRIVATEMODE_ENDPOINT` beside a fixed address) is never asked for.
 */
export function settingsOf(
  env: readonly string[],
  addresses: readonly (string | undefined)[] = [],
): ProviderSetting[] {
  const named = new Set(addresses.flatMap((address) => (address ? templateNames(address) : [])))
  return env
    .filter((name) => !isSecretSettingName(name) && (named.has(name) || CLOUD_READ.has(name)))
    .map((name) => ({ name, ...(KNOWN[name] ?? { label: name, required: true }) }))
}

/** A setting a request needs and the connection does not have. */
export class MissingSettingError extends Error {
  constructor(readonly names: readonly string[]) {
    super(
      `This connection needs ${names.join(', ')}; set ${names.length > 1 ? 'them' : 'it'} in the connection's settings`,
    )
    this.name = 'MissingSettingError'
  }
}

/** A setting whose value would send the connection's requests somewhere it does not name. */
export class InvalidSettingError extends Error {
  constructor(
    readonly setting: string,
    expected: string,
  ) {
    super(`${setting} must be ${expected}`)
    this.name = 'InvalidSettingError'
  }
}

/** A whole address (`${NEON_AI_GATEWAY_BASE_URL}/v1`): https, or http to this computer only. */
function originValue(name: string, value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new InvalidSettingError(name, 'a full https:// address')
  }
  const loopback = LOOPBACK.has(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new InvalidSettingError(name, 'a full https:// address with no query or credentials')
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/**
 * A host or a host's first label. A pasted `https://host/` keeps just its host; a label followed by
 * the address's own domain (`${AZURE_RESOURCE_NAME}.openai.azure.com`) must be a single label, so
 * the request stays under that domain.
 */
function hostValue(name: string, value: string, singleLabel: boolean): string {
  let host = value
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.pathname !== '/' || url.search || url.hash || url.username || url.port) throw 0
      host = url.hostname
    } catch {
      throw new InvalidSettingError(name, 'a host name')
    }
  }
  const labels = host.toLowerCase().split('.')
  if ((singleLabel && labels.length !== 1) || !labels.every((label) => LABEL.test(label)))
    throw new InvalidSettingError(
      name,
      singleLabel ? 'a single name (letters, digits, -)' : 'a host name',
    )
  return labels.join('.')
}

/**
 * An address with its variables filled from the connection's settings. Where a variable sits
 * decides what it may hold: the whole start of the address is a full URL, a part of the host is a
 * host name, and anything in the path is encoded as one path segment.
 */
export function fillTemplate(
  address: string,
  settings: Readonly<Record<string, string>> | undefined,
): string {
  const missing = templateNames(address).filter((name) => !settings?.[name]?.trim())
  if (missing.length > 0) throw new MissingSettingError(missing)
  const hostEnd = (() => {
    const scheme = address.indexOf('://')
    if (scheme < 0) return -1
    const slash = address.indexOf('/', scheme + 3)
    return slash < 0 ? address.length : slash
  })()
  return address.replace(TEMPLATE, (match: string, name: string, offset: number) => {
    const value = settings![name]!.trim()
    if (offset === 0) return originValue(name, value)
    if (offset < hostEnd) return hostValue(name, value, address[offset + match.length] === '.')
    return encodeURIComponent(value)
  })
}

/** A setting's value, or a missing-setting error when a request cannot go without it. */
export function requireSetting(
  settings: Readonly<Record<string, string>> | undefined,
  name: string,
): string {
  const value = settings?.[name]?.trim()
  if (!value) throw new MissingSettingError([name])
  return value
}
