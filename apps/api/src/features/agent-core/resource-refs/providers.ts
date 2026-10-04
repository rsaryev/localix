/** Resource namespaces owned by host features. Plugin namespaces stay plugin-owned. */
export const RESOURCE_PROVIDERS = {
  capability: 'capability',
  chat: 'chat',
  git: 'git',
  vault: 'vault',
} as const

export type ResourceProviderId = (typeof RESOURCE_PROVIDERS)[keyof typeof RESOURCE_PROVIDERS]
