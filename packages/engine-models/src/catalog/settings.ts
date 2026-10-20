/**
 * A PROVIDER'S OWN SETTINGS: what a connection names besides its key — the cloud region, the
 * resource or the project its requests go to (`AWS_REGION`, `AZURE_RESOURCE_NAME`,
 * `GOOGLE_VERTEX_PROJECT`).
 *
 * models.dev lists every variable a provider reads; the ones that are not secrets are settings, and
 * an address may name them (`https://${AZURE_RESOURCE_NAME}.openai.azure.com/openai/v1`). A
 * connection stores them beside its key, and they are filled in per request — never from the
 * server's environment, which would quietly lend a connection credentials it was not given.
 */

export interface ProviderSetting {
  /** The variable models.dev names, which the connection stores it under. */
  name: string
  label: string
  placeholder?: string
  /** A request cannot be made without it. */
  required: boolean
}

const SECRET = /KEY|SECRET|TOKEN|CREDENTIALS|PASSWORD/i
const TEMPLATE = /\$\{([A-Z0-9_]+)\}/g

/** What a person is asked for, by variable; others get their name as the label. */
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
}

/** The settings among a provider's variables: every one that is not a secret. */
export function settingsOf(env: readonly string[]): ProviderSetting[] {
  return env
    .filter((name) => !SECRET.test(name))
    .map((name) => ({ name, ...(KNOWN[name] ?? { label: name, required: true }) }))
}

/** The variables an address names. */
export function templateNames(address: string): string[] {
  return [...address.matchAll(TEMPLATE)].map((match) => match[1]!)
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

/** An address with its variables filled from the connection's settings. */
export function fillTemplate(
  address: string,
  settings: Readonly<Record<string, string>> | undefined,
): string {
  const missing = templateNames(address).filter((name) => !settings?.[name]?.trim())
  if (missing.length > 0) throw new MissingSettingError(missing)
  return address.replace(TEMPLATE, (_, name: string) => encodeURIComponent(settings![name]!.trim()))
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
