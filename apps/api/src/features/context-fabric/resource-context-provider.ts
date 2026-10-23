/**
 * The resource-context provider builder now lives in
 * `@localixai/mini-app-sdk/backend` so mini apps consume it from the SDK instead of
 * deep-importing this host path. This file re-exports it to keep the host's
 * existing internal import path working.
 */
export {
  createResourceContextProvider,
  namespacedResourceKind,
} from '@localixai/mini-app-sdk/backend'
export type { ResourceContextExpander } from '@localixai/mini-app-sdk/backend'
