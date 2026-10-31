import {
  type ResourceRefProvider,
  type ContextProviderContribution,
  createResourceContextProvider,
} from '@localixai/mini-app-sdk/backend'

import { createCapabilityResourceProvider } from './resource-provider'

/**
 * Capability links use the same resource-backed Context Fabric contract as every
 * other opaque provider URI. The chat pipeline stays unaware of capability kinds:
 * this owner validates and expands `localix://resource/capability`, while the shared factory owns
 * capture, revisioning, quotas, cancellation, and model-facing provenance.
 *
 * A capability reference is descriptive context, not invocation authority. The
 * resolver never enables a plugin/MCP server, calls a tool, or executes a skill.
 */
export function createCapabilityContextProvider(
  resourceProvider: ResourceRefProvider = createCapabilityResourceProvider(),
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'capability-context',
    namespace: 'capability',
    expander: resourceProvider,
    destinations: ['chat'],
    sensitivity: 'public',
    maxTokens: 512,
    timeoutMs: 100,
  })
}
