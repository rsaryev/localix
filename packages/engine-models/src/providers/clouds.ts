/**
 * THE THREE CLOUDS: Amazon Bedrock, Azure and Google Vertex — the same models as their makers',
 * reached through a cloud account. Beside its key a connection names where in that account its
 * requests go (a region, a resource, a project), and every value is passed explicitly: these SDKs
 * fall back to the server's environment (`AWS_*`, `GOOGLE_*`) for what they are not given, which
 * would quietly lend a connection credentials it never had.
 */
import type { LanguageModelV4 } from '@ai-sdk/provider'

import type { CatalogEntry } from '../catalog/catalog'
import { MissingSettingError, requireSetting } from '../catalog/settings'
import type { WireProfile } from '../wire/prompt'
import type { ProviderAccess } from './connect'

/** The families served here. */
export const CLOUD_FAMILIES = new Set(['bedrock', 'azure', 'vertex', 'vertex-anthropic'])

/** A Google Cloud service account key, as the console downloads it. */
interface ServiceAccount {
  client_email: string
  private_key: string
  project_id?: string
}

function serviceAccountOf(key: string): ServiceAccount | undefined {
  if (!key.trimStart().startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(key) as Partial<ServiceAccount>
    return typeof parsed.client_email === 'string' && typeof parsed.private_key === 'string'
      ? (parsed as ServiceAccount)
      : undefined
  } catch {
    return undefined
  }
}

/** The setting naming an Azure resource, whichever of the Azure providers stored it. */
function azureResource(settings: Readonly<Record<string, string>> | undefined): string {
  const name = Object.keys(settings ?? {}).find((key) => key.endsWith('RESOURCE_NAME'))
  return requireSetting(settings, name ?? 'AZURE_RESOURCE_NAME')
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
  switch (entry.route.family) {
    case 'bedrock': {
      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock')
      return createAmazonBedrock({
        ...common,
        region: requireSetting(settings, 'AWS_REGION'),
        apiKey: key,
      }).languageModel(id)
    }
    case 'azure': {
      const { createAzure } = await import('@ai-sdk/azure')
      const azure = createAzure({
        ...common,
        apiKey: key,
        ...(baseURL ? { baseURL } : { resourceName: azureResource(settings) }),
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
    default:
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
    default:
      return { namespace: 'bedrock', cacheBreakpoints: false, temperature }
  }
}
