/**
 * The resource-context provider builder now lives in
 * `@localixai/plugin-sdk/backend` so plugins consume it from the SDK instead of
 * deep-importing this host path. This file re-exports it to keep the host's
 * existing internal import path working.
 */
export {
  createResourceContextProvider,
  namespacedResourceKind,
} from '@localixai/plugin-sdk/backend'
export type {
  ResourceContextExpander,
  ResourceContextKind,
  ResourceContextProviderSpec,
} from '@localixai/plugin-sdk/backend'
