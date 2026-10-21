/**
 * THE THREE CLOUDS: Amazon Bedrock, Azure and Google Vertex — the same models as their makers',
 * reached through a cloud account. Beside its key a connection names where in that account its
 * requests go (a region, a resource, a project), and every value is passed explicitly: these SDKs
 * fall back to the server's environment (`AWS_*`, `GOOGLE_*`) for what they are not given, which
 * would quietly lend a connection credentials it never had.
 */
import type { LanguageModelV4 } from '@ai-sdk/provider'

import type { CatalogEntry } from '../catalog/catalog'
import {
  fillTemplate,
  InvalidSettingError,
  MissingSettingError,
  requireSetting,
} from '../catalog/settings'
import type { WireProfile } from '../wire/prompt'
import type { ProviderAccess } from './connect'

/** The families served here. */
export const CLOUD_FAMILIES = new Set(['bedrock', 'azure', 'vertex', 'vertex-anthropic'])

/** A Google Cloud service account key, as the console downloads it. */
interface ServiceAccount {
  type: 'service_account'
  client_email: string
  private_key: string
  private_key_id?: string
  client_id?: string
  project_id?: string
  token_uri: string
}

const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'
const REGION = /^[a-z]{2}(?:-[a-z0-9]+){1,3}$/

/**
 * A service account key, rebuilt from the fields such a key carries. Never handed over as pasted:
 * google-auth-library picks its client by `type`, and an `external_account` "key" would read a
 * local file (`credential_source.file`) and post it to a `token_url` of the sender's choosing.
 * Undefined for an express-mode API key; a JSON object that is not a service account is refused,
 * never sent on as if it were an API key.
 */
export function serviceAccountOf(key: string): ServiceAccount | undefined {
  if (!key.trimStart().startsWith('{')) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(key) as Record<string, unknown>
  } catch {
    throw new Error('The Google Cloud key is not valid JSON; paste the service account key file')
  }
  const text = (name: string) => (typeof parsed[name] === 'string' ? parsed[name] : undefined)
  const email = text('client_email')
  const privateKey = text('private_key')
  if (parsed.type !== 'service_account' || !email || !privateKey)
    throw new Error('Only a Google Cloud service account key (type "service_account") is accepted')
  const optional = (name: 'private_key_id' | 'client_id' | 'project_id') =>
    text(name) ? { [name]: text(name) } : {}
  return {
    type: 'service_account',
    client_email: email,
    private_key: privateKey,
    ...optional('private_key_id'),
    ...optional('client_id'),
    ...optional('project_id'),
    token_uri: GOOGLE_TOKEN_URI,
  }
}

/** Vertex's project and location: the project the key names unless the connection says otherwise. */
function vertexPlace(
  settings: Readonly<Record<string, string>> | undefined,
  account: ServiceAccount,
  defaultLocation: string,
) {
  const project = settings?.GOOGLE_VERTEX_PROJECT?.trim() || account.project_id
  if (!project) throw new MissingSettingError(['GOOGLE_VERTEX_PROJECT'])
  return { project, location: settings?.GOOGLE_VERTEX_LOCATION?.trim() || defaultLocation }
}

/** Bedrock's address in the connection's region: always explicit, never `AWS_ENDPOINT_URL`. */
function bedrockAddress(settings: Readonly<Record<string, string>> | undefined): {
  region: string
  baseURL: string
} {
  const region = requireSetting(settings, 'AWS_REGION').toLowerCase()
  if (!REGION.test(region)) throw new InvalidSettingError('AWS_REGION', 'an AWS region (us-east-1)')
  const suffix = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'
  return { region, baseURL: `https://bedrock-runtime.${region}.${suffix}` }
}

/**
 * The Azure address: the resource's own host, Azure OpenAI's or (for the Cognitive Services
 * provider) Cognitive Services'. Passed as an address, so `AZURE_RESOURCE_NAME` is never read.
 */
function azureAddress(settings: Readonly<Record<string, string>> | undefined): string {
  if (settings?.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME?.trim())
    return fillTemplate(
      'https://${AZURE_COGNITIVE_SERVICES_RESOURCE_NAME}.cognitiveservices.azure.com/openai',
      settings,
    )
  const name =
    Object.keys(settings ?? {}).find((key) => key.endsWith('RESOURCE_NAME')) ??
    'AZURE_RESOURCE_NAME'
  requireSetting(settings, name)
  return fillTemplate(`https://\${${name}}.openai.azure.com/openai`, settings)
}

export async function cloudModelFor(
  entry: CatalogEntry,
  access: ProviderAccess,
  baseURL: string | undefined,
): Promise<LanguageModelV4> {
  const key = access.apiKey?.trim()
  if (!key) throw new Error(`${entry.provider.name} needs a key; add one to the connection`)
  const { settings } = access
  const common = {
    ...(access.headers ? { headers: access.headers } : {}),
    ...(access.fetch ? { fetch: access.fetch } : {}),
  }
  const id = entry.model.id
  const family = entry.route.family
  switch (family) {
    case 'bedrock': {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock')
      return createAmazonBedrock({
        ...common,
        ...bedrockAddress(settings),
        apiKey: key,
      }).languageModel(id)
    }
    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure')
      const azure = createAzure({
        ...common,
        apiKey: key,
        baseURL: baseURL ?? azureAddress(settings),
      })
      return entry.route.shape === 'completions' ? azure.chat(id) : azure.responses(id)
    }
    case 'vertex': {
      const { createVertex } = await import('@ai-sdk/google-vertex')
      const account = serviceAccountOf(key)
      // Not a service account key: an express-mode API key, which needs no project.
      if (!account) return createVertex({ ...common, apiKey: key }).languageModel(id)
      return createVertex({
        ...common,
        // An empty key, so the SDK never reads `GOOGLE_VERTEX_API_KEY` and leaves the account.
        apiKey: '',
        ...vertexPlace(settings, account, 'us-central1'),
        googleAuthOptions: { credentials: account },
      }).languageModel(id)
    }
    case 'vertex-anthropic': {
      const { createVertexAnthropic } = await import('@ai-sdk/google-vertex/anthropic')
      const account = serviceAccountOf(key)
      if (!account)
        throw new Error('Claude on Vertex needs a service account key (JSON), not an API key')
      return createVertexAnthropic({
        ...common,
        ...vertexPlace(settings, account, 'global'),
        googleAuthOptions: { credentials: account },
      }).languageModel(id)
    }
    case 'openai':
    case 'anthropic':
    case 'google':
    case 'openrouter':
    case 'gateway':
    case 'openai-compatible':
      throw new Error(`${entry.provider.name} is not a cloud provider`)
  }
}

/** How requests to a cloud are shaped: under the namespace its SDK reads and writes. */
export function cloudProfile(
  entry: CatalogEntry,
  openaiOptions: WireProfile['requestOptions'],
): WireProfile {
  const temperature = entry.model.temperature
  switch (entry.route.family) {
    case 'azure':
      // Azure OpenAI is OpenAI's API under Azure's name: the same stateless requests.
      return {
        namespace: 'azure',
        cacheBreakpoints: false,
        temperature,
        ...(openaiOptions ? { requestOptions: openaiOptions } : {}),
      }
    case 'vertex':
      return { namespace: 'vertex', cacheBreakpoints: false, temperature }
    case 'vertex-anthropic':
      return { namespace: 'anthropic', cacheBreakpoints: true, temperature }
    case 'bedrock':
    case 'openai':
    case 'anthropic':
    case 'google':
    case 'openrouter':
    case 'gateway':
    case 'openai-compatible':
      return { namespace: 'bedrock', cacheBreakpoints: false, temperature }
  }
}
