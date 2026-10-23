import { buildResourceUri, type ResourceRefProvider } from '@localixai/mini-app-sdk/backend'
import {
  capabilitySettingsUiUri,
  parseCapabilityResourceUri,
} from '@localixai/mini-app-sdk/navigation'
import { RESOURCE_PROVIDERS } from '../agent-core/resource-refs/providers'

const PROVIDER = RESOURCE_PROVIDERS.capability

const LINK_SEMANTICS =
  'User-selected context only; linking does not enable or invoke this capability.'
const GUIDANCE =
  'Use this capability only if it is available and relevant. If its settings may help, link them with their exact `localix://` URI in your reply — the workbench renders it as a button.'

/**
 * Dragged capability references are resource refs: one generic provider keeps the
 * composer agnostic to every current and future capability registry.
 */
export function createCapabilityResourceProvider(): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'Capabilities',
    async listChildren() {
      // The workspace launcher is the authoritative scoped browser. Keep the
      // generic @resource tree honest instead of duplicating a stale catalog.
      return [
        {
          uri: buildResourceUri(PROVIDER, ['help']),
          label: 'Drag from the Capabilities panel',
          detail: 'Plugins, skills, tools, agents, MCP servers, and views',
          hasChildren: false,
          notice: true,
          navigationOnly: true,
        },
      ]
    },
    async expand(_userId, uri) {
      const resource = parseCapabilityResourceUri(uri)
      if (!resource) return { ok: false, error: 'invalid capability reference' }
      const scope = resource.scope ? `project ${resource.scope}` : 'sessions without a project'
      const availability =
        resource.enabled === undefined ? 'not captured' : resource.enabled ? 'enabled' : 'disabled'
      const lines = [
        `Capability: ${resource.label || resource.id}`,
        `Kind: ${resource.kind}`,
        `Identifier: ${resource.id}`,
        `Scope: ${scope}`,
        `Availability when linked: ${availability}`,
        resource.description ? `Description: ${resource.description}` : null,
        `Settings URI: ${capabilitySettingsUiUri(resource)}`,
        `Link semantics: ${LINK_SEMANTICS}`,
        `Guidance: ${GUIDANCE}`,
      ].filter((line): line is string => Boolean(line))
      return { ok: true, content: lines.join('\n') }
    },
  }
}
